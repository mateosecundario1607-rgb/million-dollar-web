// api/create-payment.js
export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar origen — solo aceptar requests de tu dominio
  const origin = req.headers['origin'] || '';
  const allowed = [
    'https://million-dollar-web-nine.vercel.app',
    'http://localhost:3000', // para desarrollo local
  ];
  if (!allowed.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { cubeId, title, description, url, imageUrl, color } = req.body;

  // Validaciones
  if (cubeId === undefined || cubeId === null) {
    return res.status(400).json({ error: 'cubeId is required' });
  }
  if (!title || typeof title !== 'string' || title.length > 40) {
    return res.status(400).json({ error: 'Invalid title' });
  }
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (typeof cubeId !== 'number' || cubeId < 0 || cubeId >= 1000) {
    return res.status(400).json({ error: 'Invalid cubeId' });
  }

  // Verificar que el cubo esté disponible
  const supabaseCheck = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/cubes?id=eq.${cubeId}&select=id`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );
  const existing = await supabaseCheck.json();
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Cube already taken' });
  }

  // Verificar que no haya un pending reciente para este cubo (anti-spam)
  const pendingCheck = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/pending_cubes?cube_id=eq.${cubeId}&select=id`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );
  const existingPending = await pendingCheck.json();
  if (existingPending.length > 0) {
    return res.status(409).json({ error: 'Cube is being purchased by someone else' });
  }

  const price   = cubeId < 15 ? 1 : 1000;
  const orderId = `cube_${cubeId}_${Date.now()}`;

  const nowRes = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'x-api-key':    process.env.NOWPAYMENTS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount:      price,
      price_currency:    'usd',
      order_id:          orderId,
      order_description: `The Million Dollar Web — Cube #${String(cubeId).padStart(3,'0')}`,
    })
  });

  if (!nowRes.ok) {
    const err = await nowRes.text();
    console.error('NOWPayments error:', err);
    return res.status(500).json({ error: 'Payment creation failed' });
  }

  const payment = await nowRes.json();

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_cubes`, {
    method: 'POST',
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      cube_id:     cubeId,
      order_id:    orderId,
      title:       title.slice(0, 40),
      description: (description || '').slice(0, 120),
      url:         url.slice(0, 200),
      image_url:   imageUrl || null,
      color:       /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ffd700',
      paid_price:  price,
      expires_at:  new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
  });

  // Headers de seguridad
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.status(200).json({
    invoiceUrl: payment.invoice_url,
    paymentId:  payment.id,
    price,
  });
}
