// middleware.js — Rate limiting para todas las rutas /api/
// Vercel ejecuta este archivo automáticamente antes de cada función

import { NextResponse } from 'next/server';

// Almacén en memoria de requests por IP
// Se resetea cada vez que Vercel reinicia la función (cada ~5 min)
const rateLimit = new Map();

const LIMITS = {
  '/api/create-payment':        { max: 5,  window: 60 },  // 5 por minuto
  '/api/create-resale-payment': { max: 5,  window: 60 },  // 5 por minuto
  '/api/webhook':               { max: 50, window: 60 },  // 50 por minuto (NOWPayments)
  'default':                    { max: 20, window: 60 },  // 20 por minuto resto
};

export function middleware(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.headers.get('x-real-ip')
          || 'unknown';

  const path     = request.nextUrl.pathname;
  const limit    = LIMITS[path] || LIMITS['default'];
  const key      = `${ip}:${path}`;
  const now      = Date.now();
  const windowMs = limit.window * 1000;

  // Limpiar entradas viejas
  for (const [k, v] of rateLimit.entries()) {
    if (now - v.start > windowMs) rateLimit.delete(k);
  }

  const current = rateLimit.get(key);

  if (!current) {
    rateLimit.set(key, { count: 1, start: now });
  } else if (now - current.start < windowMs) {
    if (current.count >= limit.max) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(limit.window),
            'X-RateLimit-Limit': String(limit.max),
            'X-RateLimit-Remaining': '0',
          }
        }
      );
    }
    current.count++;
  } else {
    rateLimit.set(key, { count: 1, start: now });
  }

  // Agregar headers de seguridad a todas las respuestas
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
