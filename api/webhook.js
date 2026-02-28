// api/webhook.js
// Vercel Serverless Function
// NOWPayments llama a esta URL cuando un pago se confirma

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verificar firma de NOWPayments (seguridad) ──
  const signature = req.headers['x-nowpayments-sig'];
  if (!signature) {
    console.warn('Webhook received without signature');
    return res.status(401).json({ error: 'No signature' });
  }

  const payload     = JSON.stringify(req.body, Object.keys(req.body).sort());
  const hmac        = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET);
  const digest      = hmac.update(payload).digest('hex');

  if (digest !== signature) {
    console.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { payment_id, payment_status, order_id, price_amount } = req.body;

  console.log(`Webhook: payment ${payment_id} status=${payment_status} order=${order_id}`);

  // Solo procesar pagos confirmados o completados
  // NOWPayments usa: waiting → confirming → confirmed → finished
  if (!['confirmed', 'finished'].includes(payment_status)) {
    return res.status(200).json({ received: true, action: 'ignored', status: payment_status });
  }

  // ── Buscar el cubo pendiente con este order_id ──
  const pendingRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pending_cubes?order_id=eq.${order_id}&select=*`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );
  const pending = await pendingRes.json();

  if (!pending.length) {
    console.error(`No pending cube found for order_id: ${order_id}`);
    return res.status(404).json({ error: 'Pending cube not found' });
  }

  const cube = pending[0];

  // ── Verificar que el cubo todavía esté libre ──
  const cubeCheck = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/cubes?id=eq.${cube.cube_id}&select=id`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );
  const existingCube = await cubeCheck.json();
  if (existingCube.length > 0) {
    // El cubo ya fue tomado (raro pero posible en race condition)
    console.warn(`Cube ${cube.cube_id} already taken, payment ${payment_id} needs refund`);
    // TODO: iniciar proceso de reembolso automático
    return res.status(200).json({ received: true, action: 'cube_taken' });
  }

  // ── Activar el cubo en Supabase ──
  const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/cubes`, {
    method: 'POST',
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      id:           cube.cube_id,
      owner_wallet: req.body.pay_address || 'unknown',
      title:        cube.title,
      description:  cube.description,
      url:          cube.url,
      image_url:    cube.image_url,
      color:        cube.color,
      paid_price:   cube.paid_price,
      payment_id:   payment_id.toString(),
      for_sale:     false,
    })
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    console.error('Supabase insert failed:', err);
    return res.status(500).json({ error: 'Database insert failed' });
  }

  // ── Borrar el pending ──
  await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pending_cubes?order_id=eq.${order_id}`,
    {
      method: 'DELETE',
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );

  console.log(`✅ Cube #${cube.cube_id} activated! Payment: ${payment_id}`);
  return res.status(200).json({ received: true, action: 'cube_activated', cubeId: cube.cube_id });
}
