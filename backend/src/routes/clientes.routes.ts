import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import prisma from '../lib/prisma';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('ADMIN', 'SUPERVISOR'));

const createClienteSchema = z.object({
  nombre: z.string().min(1).max(150),
  codigo: z.string().min(1).max(50).toUpperCase(),
  icono: z.string().max(10).optional(),
  isActive: z.boolean().optional().default(true),
});

const updateClienteSchema = createClienteSchema.partial();

router.get('/', async (req: AuthRequest, res: Response) => {
  const { search, isActive } = req.query as Record<string, string>;

  const where = {
    deletedAt: null,
    ...(search ? { OR: [{ nombre: { contains: search, mode: 'insensitive' as const } }, { codigo: { contains: search, mode: 'insensitive' as const } }] } : {}),
    ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, codigo: true, icono: true, isActive: true, createdAt: true, _count: { select: { evaluations: true } } },
    }),
    prisma.cliente.count({ where }),
  ]);

  res.json({ data, total });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const body = createClienteSchema.parse(req.body);

  const existing = await prisma.cliente.findFirst({ where: { codigo: body.codigo } });
  if (existing && !existing.deletedAt) {
    res.status(409).json({ error: `Ya existe un cliente con el código ${body.codigo}` });
    return;
  }

  if (existing && existing.deletedAt) {
    const cliente = await prisma.cliente.update({
      where: { id: existing.id },
      data: { ...body, deletedAt: null },
    });
    res.status(201).json(cliente);
    return;
  }

  const cliente = await prisma.cliente.create({ data: body });
  res.status(201).json(cliente);
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const body = updateClienteSchema.parse(req.body);

  const existing = await prisma.cliente.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }

  if (body.codigo && body.codigo !== existing.codigo) {
    const conflict = await prisma.cliente.findFirst({ where: { codigo: body.codigo, deletedAt: null, NOT: { id } } });
    if (conflict) {
      res.status(409).json({ error: `Ya existe un cliente con el código ${body.codigo}` });
      return;
    }
  }

  const cliente = await prisma.cliente.update({ where: { id }, data: body });
  res.json(cliente);
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const existing = await prisma.cliente.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    res.status(404).json({ error: 'Cliente no encontrado' });
    return;
  }

  await prisma.cliente.update({ where: { id }, data: { deletedAt: new Date() } });
  res.json({ message: 'Cliente eliminado' });
});

export default router;
