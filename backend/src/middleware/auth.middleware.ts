import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyToken } from '../services/token.service';

export interface AuthPayload {
  userId: string;
  email: string;
  role: Role;
  gestorId?: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.accessToken as string | undefined;
  const header = req.headers.authorization;
  const bearerToken = header && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = cookieToken ?? bearerToken;

  if (!token) {
    res.status(401).json({ error: 'Token de autorización requerido' });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.tokenType !== 'access') {
      res.status(401).json({ error: 'Token inválido' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
