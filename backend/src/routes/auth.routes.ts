import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import * as authService from '../services/auth.service';
import { clearAuthCookies, setAuthCookies } from '../services/token.service';
import { loginLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(2, 'Usuario invalido').optional(),
  usuario: z.string().trim().min(2, 'Usuario inválido').optional(),
  email: z.string().email('Email inválido').optional(),
  password: z.string().min(6, 'Contraseña muy corta'),
}).refine((data) => !!data.username || !!data.usuario || !!data.email, {
  message: 'Usuario requerido',
  path: ['username'],
});

// POST /api/v1/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos de login inválidos' });
    return;
  }

  const body = parsed.data;
  const identifier = body.username ?? body.usuario ?? body.email;
  const result = await authService.login(identifier!, body.password);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ user: result.user });
});

router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ error: 'Refresh token requerido' });
    return;
  }

  const result = await authService.rotateRefreshToken(refreshToken);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ user: result.user });
});

// POST /api/v1/auth/logout
router.post('/logout', authMiddleware, (_req: Request, res: Response) => {
  clearAuthCookies(res);
  res.json({ message: 'Sesión cerrada correctamente' });
});

// GET /api/v1/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await authService.getMe(req.user!.userId);
  res.json(user);
});

export default router;
