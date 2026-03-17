// middleware.js — Rate limiting sin Next.js
export default function middleware(request) {
  const { pathname } = new URL(request.url);

  // Solo aplicar a rutas /api/
  if (!pathname.startsWith('/api/')) {
    return new Response(null, { status: 200 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const LIMITS = {
    '/api/create-payment':        5,
    '/api/create-resale-payment': 5,
    '/api/webhook':               50,
  };

  const max = LIMITS[pathname] || 20;
  const key = `${ip}:${pathname}`;
  const now = Date.now();

  if (!globalThis._rl) globalThis._rl = new Map();
  const rl = globalThis._rl;

  // Limpiar viejos
  for (const [k, v] of rl.entries()) {
    if (now - v.start > 60000) rl.delete(k);
  }

  const entry = rl.get(key);
  if (!entry) {
    rl.set(key, { count: 1, start: now });
  } else if (now - entry.start < 60000) {
    if (entry.count >= max) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
      );
    }
    entry.count++;
  } else {
    rl.set(key, { count: 1, start: now });
  }

  return new Response(null, { status: 200 });
}

export const config = {
  matcher: '/api/:path*',
  runtime: 'edge',
};
