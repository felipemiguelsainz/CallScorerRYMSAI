import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth.middleware';

declare module 'express-serve-static-core' {
  interface Request {
    scopeFilter?: Record<string, unknown>;
  }
}

export function filterByUserScope(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user) {
    req.scopeFilter = {};
    next();
    return;
  }

  if (req.user.role === 'GESTOR' && req.user.gestorId) {
    req.scopeFilter = { gestorId: req.user.gestorId };
  } else if (req.user.role === 'AUDITOR') {
    req.scopeFilter = { auditorId: req.user.userId };
  } else {
    req.scopeFilter = {};
  }

  next();
}
