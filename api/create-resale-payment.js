// api/create-resale-payment.js
// Crea un pago para comprar un cubo en reventa
// El vendedor recibe 98.5%, el 1.5% queda en NOWPayments para retiro manual

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cubeId } = req.body;

  if (cubeId === undefined || cubeId === null) {
    return res.status(400).json({ error: 'cubeId is required' });
  }

  // Buscar el cubo en Supabase y verificar que esté en venta
  const cubeRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/cubes?id=eq.${cubeId}&select=*`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    }
  );
  const cubes = await cubeRes.json();

  if (!cubes.length) {
    return res.status(404).json({ error: 'Cube not found' });
  }

  const cube = cubes[0];

  if (!cube.for_sale) {
    return res.status(400).json({ error: 'Cube is not for sale' });
  }

  const askPrice   = parseFloat(cube.ask_price);
  const fee        = parseFloat((askPrice * 0.015).toFixed(2));  // 1.5% comisión
  const sellerGets = parseFloat((askPrice - fee).toFixed(2));    // 98.5% al vendedor
  const orderId    = `resale_${cubeId}_${Date.now()}`;

  // Crear invoice en NOWPayments por el precio completo
  const nowRes = await fetch('https://api.nowpayments.io/v1/invoice', {
    method: 'POST',
    headers: {
      'x-api-key':    process.env.NOWPAYMENTS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount:      askPrice,
      price_currency:    'usd',
      order_id:          orderId,
      order_description: `Million Dollar Web — Resale Cube #${String(cubeId).padStart(3,'0')} — ${cube.title}`,
    })
  });

  if (!nowRes.ok) {
    const err = await nowRes.text();
    console.error('NOWPayments error:', err);
    return res.status(500).json({ error: 'Payment creation failed', detail: err });
  }

  const payment = await nowRes.json();

  // Guardar la transacción pendiente en Supabase
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_resales`, {
    method: 'POST',
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      cube_id:      cubeId,
      order_id:     orderId,
      ask_price:    askPrice,
      fee:          fee,
      seller_gets:  sellerGets,
      seller_wallet: cube.owner_wallet,
      contact:      cube.contact,
      expires_at:   new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
  });

  return res.status(200).json({
    invoiceUrl:  payment.invoice_url,
    paymentId:   payment.id,
    askPrice,
    fee,
    sellerGets,
    contact:     cube.contact,
  });
}
