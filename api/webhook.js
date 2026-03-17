// api/webhook.js — maneja compras nuevas Y reventas
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-nowpayments-sig'];
  if (signature) {
    const payload = JSON.stringify(req.body, Object.keys(req.body).sort());
    const digest  = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET).update(payload).digest('hex');
    if (digest !== signature) return res.status(401).json({ error: 'Invalid signature' });
  }

  const { payment_id, payment_status, order_id } = req.body;
  console.log(`Webhook: payment ${payment_id} status=${payment_status} order=${order_id}`);

  if (!['confirmed', 'finished'].includes(payment_status)) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  // ── REVENTA ──
  if (order_id && order_id.startsWith('resale_')) {
    const pendingRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/pending_resales?order_id=eq.${order_id}&select=*`,
      { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    const pending = await pendingRes.json();
    if (!pending.length) return res.status(404).json({ error: 'Pending resale not found' });

    const resale = pending[0];
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/cubes?id=eq.${resale.cube_id}`, {
      method: 'PATCH',
      headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_wallet: req.body.pay_address || 'unknown', for_sale: false, ask_price: null, contact: null, paid_price: resale.ask_price })
    });
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/resales`, {
      method: 'POST',
      headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ cube_id: resale.cube_id, ask_price: resale.ask_price, contact: resale.contact, sold_at: new Date().toISOString() })
    });
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_resales?order_id=eq.${order_id}`, {
      method: 'DELETE',
      headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
    });
    console.log(`✅ Resale cube #${resale.cube_id} — seller gets $${resale.seller_gets} — contact: ${resale.contact}`);
    return res.status(200).json({ received: true, action: 'resale_completed', cubeId: resale.cube_id });
  }

  // ── COMPRA NUEVA ──
  const pendingRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pending_cubes?order_id=eq.${order_id}&select=*`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  );
  const pending = await pendingRes.json();
  if (!pending.length) return res.status(404).json({ error: 'Pending cube not found' });

  const cube = pending[0];
  const cubeCheck = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/cubes?id=eq.${cube.cube_id}&select=id`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  );
  if ((await cubeCheck.json()).length > 0) {
    return res.status(200).json({ received: true, action: 'cube_already_taken' });
  }

  const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/cubes`, {
    method: 'POST',
    headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      id: cube.cube_id, owner_wallet: req.body.pay_address || 'unknown',
      title: cube.title, description: cube.description, url: cube.url,
      image_url: cube.image_url, color: cube.color, paid_price: cube.paid_price,
      payment_id: String(payment_id || order_id), for_sale: false,
    })
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    console.error('Supabase insert failed:', err);
    return res.status(500).json({ error: 'Database insert failed' });
  }

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_cubes?order_id=eq.${order_id}`, {
    method: 'DELETE',
    headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` }
  });

  console.log(`✅ Cube #${cube.cube_id} activated! Payment: ${payment_id}`);
  return res.status(200).json({ received: true, action: 'cube_activated', cubeId: cube.cube_id });
}
