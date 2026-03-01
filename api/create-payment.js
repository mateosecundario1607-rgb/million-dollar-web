// api/create-payment.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cubeId, title, description, url, imageUrl, color } = req.body;

  if (cubeId === undefined || cubeId === null) {
    return res.status(400).json({ error: 'cubeId is required' });
  }
  if (!title || !url) {
    return res.status(400).json({ error: 'title and url are required' });
  }

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
    return res.status(500).json({ error: 'Payment creation failed', detail: err });
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
      title,
      description: description || '',
      url,
      image_url:   imageUrl || null,
      color:       color || '#ffd700',
      paid_price:  price,
      expires_at:  new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
  });

  return res.status(200).json({
    invoiceUrl: payment.invoice_url,
    paymentId:  payment.id,
    price,
  });
}
