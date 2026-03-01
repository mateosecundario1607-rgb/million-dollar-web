// api/webhook-resale.js
// NOWPayments llama a esta URL cuando se confirma un pago de reventa

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar firma
  const signature = req.headers['x-nowpayments-sig'];
  if (signature) {
    const payload = JSON.stringify(req.body, Object.keys(req.body).sort());
    const hmac    = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET);
    const digest  = hmac.update(payload).digest('hex');
    if (digest !== signature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const { payment_status, order_id } = req.body;

  if (!['confirmed', 'finished'].includes(payment_status)) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  // Solo procesar órdenes de reventa
  if (!order_id.startsWith('resale_')) {
    return res.status(200).json({ received: true, action: 'not_resale' });
  }

  // Buscar el pending resale
  const pendingRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pending_resales?order_id=eq.${order_id}&select=*`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );
  const pending = await pendingRes.json();

  if (!pending.length) {
    return res.status(404).json({ error: 'Pending resale not found' });
  }

  const resale  = pending[0];
  const cubeId  = resale.cube_id;
  const buyerAddress = req.body.pay_address || 'unknown';

  // Actualizar el cubo: nuevo dueño = comprador, ya no está en venta
  await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/cubes?id=eq.${cubeId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        owner_wallet: buyerAddress,
        for_sale:     false,
        ask_price:    null,
        contact:      null,
        paid_price:   resale.ask_price,
      })
    }
  );

  // Guardar en historial de ventas
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/resales`, {
    method: 'POST',
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      cube_id:       cubeId,
      ask_price:     resale.ask_price,
      contact:       resale.contact,
      sold_at:       new Date().toISOString(),
    })
  });

  // Borrar el pending
  await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pending_resales?order_id=eq.${order_id}`,
    {
      method: 'DELETE',
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );

  // TODO: enviar el 98.5% al vendedor via NOWPayments Mass Payouts
  // Por ahora el pago completo queda en tu cuenta NOWPayments
  // y vos manualmente transferís al vendedor desde el dashboard.
  // Esto se puede automatizar con la API de Mass Payouts cuando tengas volumen.
  console.log(`✅ Resale cube #${cubeId} — seller gets $${resale.seller_gets} — contact: ${resale.contact}`);

  return res.status(200).json({ received: true, action: 'resale_completed', cubeId });
}
