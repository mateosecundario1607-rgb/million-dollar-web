// api/create-payment.js
// Vercel Serverless Function
// Crea un pago en NOWPayments y devuelve la URL de pago

export default async function handler(req, res) {
  // Solo aceptar POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cubeId, title, description, url, imageUrl, color } = req.body;

  // Validaciones básicas
  if (cubeId === undefined || cubeId === null) {
    return res.status(400).json({ error: 'cubeId is required' });
  }
  if (!title || !url) {
    return res.status(400).json({ error: 'title and url are required' });
  }

  // Verificar que el cubo esté disponible en Supabase
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

  // Determinar precio: $1 los primeros 15 cubos, $1000 el resto
  const price = cubeId < 15 ? 1 : 1000;

  // Crear pago en NOWPayments
  const nowRes = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'x-api-key':   process.env.NOWPAYMENTS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount:    price,
      price_currency:  'usd',
      pay_currency:    'usdtsol',   // USDT en Solana (sin gas fees)
      order_id:        `cube_${cubeId}_${Date.now()}`,
      order_description: `The Million Dollar Web — Cube #${String(cubeId).padStart(3,'0')}`,
      ipn_callback_url: `${process.env.VERCEL_URL}/api/webhook`,
      success_url:     `${process.env.VERCEL_URL}/?success=1&cube=${cubeId}`,
      cancel_url:      `${process.env.VERCEL_URL}/?cancelled=1`,
      // Guardamos los datos del cubo en los metadatos
      // para usarlos cuando llegue el webhook
      partially_paid_url: `${process.env.VERCEL_URL}/?partial=1`,
    })
  });

  if (!nowRes.ok) {
    const err = await nowRes.text();
    console.error('NOWPayments error:', err);
    return res.status(500).json({ error: 'Payment creation failed' });
  }

  const payment = await nowRes.json();

  // Guardar datos del cubo en Supabase como "pending"
  // para que nadie más pueda comprarlo mientras está en proceso
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
      order_id:    payment.id.toString(),
      title,
      description: description || '',
      url,
      image_url:   imageUrl || null,
      color:       color || '#ffd700',
      paid_price:  price,
      expires_at:  new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    })
  });

  return res.status(200).json({
    invoiceUrl: payment.invoice_url,
    paymentId:  payment.id,
    price,
  });
}
