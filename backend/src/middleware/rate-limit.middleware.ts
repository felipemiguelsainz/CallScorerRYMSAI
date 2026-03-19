import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { AuthRequest } from './auth.middleware';

function normalizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().slice(0, 120);
}

function loginKeyGenerator(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const identifier =
    normalizeIdentifier(body?.username) ||
    normalizeIdentifier(body?.usuario) ||
    normalizeIdentifier(body?.email) ||
    'unknown';
  const ip = req.ip ?? 'unknown-ip';
  return `login:${identifier}:${ip}`;
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: loginKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' },
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthRequest;
    return authReq.user?.userId ?? req.ip ?? 'anonymous';
  },
  message: { error: 'Rate limit excedido. Intenta nuevamente en un minuto.' },
});

export const uploadAudioLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthRequest;
    return authReq.user?.userId ?? req.ip ?? 'anonymous';
  },
  message: { error: 'Límite de subidas por hora excedido.' },
});
