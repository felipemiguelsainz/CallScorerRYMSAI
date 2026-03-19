import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import prisma from '../lib/prisma';

const router = Router();

router.use(authMiddleware);

const uuidSchema = z.string().uuid('ID inválido');

router.param('id', (req, res, next, value) => {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: 'ID inválido' });
    return;
  }
  next();
});

const gestorSchema = z.object({
  name: z.string().min(2, 'Nombre muy corto'),
  legajo: z.string().optional(),
});

// GET /api/v1/gestores
router.get('/', async (req: AuthRequest, res: Response) => {
  const { role } = req.query as Record<string, string>;
  const scopedGestorId = req.user?.role === 'GESTOR' ? req.user.gestorId : undefined;

  const gestores = await prisma.gestor.findMany({
    where: {
      deletedAt: null,
      ...(scopedGestorId ? { id: scopedGestorId } : {}),
      ...(role === 'GESTOR' ? { users: { some: { role: 'GESTOR' } } } : {}),
    },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { evaluations: true } },
    },
  });
  res.json(gestores);
});

// POST /api/v1/gestores
router.post('/', requireRole('ADMIN', 'SUPERVISOR'), async (req: AuthRequest, res: Response) => {
  const body = gestorSchema.parse(req.body);
  const gestor = await prisma.gestor.create({ data: body });
  res.status(201).json(gestor);
});

// GET /api/v1/gestores/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'GESTOR' && req.user.gestorId !== req.params.id) {
    res.status(403).json({ error: 'No autorizado para este gestor' });
    return;
  }

  const gestor = await prisma.gestor.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { _count: { select: { evaluations: true } } },
  });
  if (!gestor) {
    res.status(404).json({ error: 'Gestor no encontrado' });
    return;
  }
  res.json(gestor);
});

// GET /api/v1/gestores/:id/evaluaciones
router.get('/:id/evaluaciones', async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'GESTOR' && req.user.gestorId !== req.params.id) {
    res.status(403).json({ error: 'No autorizado para este gestor' });
    return;
  }

  const evaluaciones = await prisma.evaluation.findMany({
    where: {
      gestorId: req.params.id,
      deletedAt: null,
      ...(req.user?.role === 'AUDITOR' ? { auditorId: req.user.userId } : {}),
    },
    include: {
      auditor: { select: { id: true, name: true, email: true } },
      debtor_analysis: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(evaluaciones);
});

export default router;
