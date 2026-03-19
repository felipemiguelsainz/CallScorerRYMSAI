import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { env } from '../config/env';

const JWT_ALGORITHM: jwt.Algorithm = 'HS256';

export interface TokenPayload {
  userId: string;
  email: string;
  role: Role;
  tokenType: 'access' | 'refresh';
}

export function signAccessToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'access' }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
  }) as TokenPayload;
}

function toMs(duration: string): number {
  const value = parseInt(duration.slice(0, -1), 10);
  const unit = duration.slice(-1);
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const sameSite = env.COOKIE_SAME_SITE;
  const secure = env.NODE_ENV === 'production' || sameSite === 'none';
  const cookieDomain = env.COOKIE_DOMAIN || undefined;

  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    domain: cookieDomain,
    path: '/',
    maxAge: toMs(env.JWT_ACCESS_EXPIRES_IN),
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    domain: cookieDomain,
    path: '/api/v1/auth',
    maxAge: toMs(env.JWT_REFRESH_EXPIRES_IN),
  });
}

export function clearAuthCookies(res: Response): void {
  const sameSite = env.COOKIE_SAME_SITE;
  const secure = env.NODE_ENV === 'production' || sameSite === 'none';
  const cookieDomain = env.COOKIE_DOMAIN || undefined;

  res.clearCookie('accessToken', { httpOnly: true, secure, sameSite, domain: cookieDomain, path: '/' });
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure,
    sameSite,
    domain: cookieDomain,
    path: '/api/v1/auth',
  });
}
