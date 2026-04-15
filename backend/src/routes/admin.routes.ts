import { Router, Response } from 'express';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { hashPassword } from '../services/auth.service';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('ADMIN'));

const roleSchema = z.enum(['GESTOR', 'AUDITOR', 'SUPERVISOR', 'ADMIN']);

const listUsersQuerySchema = z.object({
  search: z.string().trim().max(150).optional(),
  role: roleSchema.optional(),
  isActive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Usuario muy corto')
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Usuario invalido'),
  role: roleSchema,
  isActive: z.boolean().optional(),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres').optional(),
});

const updateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Usuario muy corto')
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Usuario invalido')
    .optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres').optional(),
});

function usernameToGestorName(username: string): string {
  return username.replace(/[._-]+/g, ' ').trim();
}

function toUserResponse(user: {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: Role;
  gestorId: string | null;
  isActive: boolean;
  authProvider: string;
  externalAuthId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  gestor?: { id: string; name: string; legajo: string | null } | null;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    gestorId: user.gestorId,
    isActive: user.isActive,
    authProvider: user.authProvider,
    externalAuthId: user.externalAuthId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    gestor: user.gestor ?? null,
  };
}

router.get('/users', async (req: AuthRequest, res: Response) => {
  const query = listUsersQuerySchema.parse(req.query);
  const skip = (query.page - 1) * query.limit;

  const where = {
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { username: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        gestor: {
          select: { id: true, name: true, legajo: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    data: data.map(toUserResponse),
    total,
    page: query.page,
    limit: query.limit,
  });
});

router.post('/users', async (req: AuthRequest, res: Response) => {
  const body = createUserSchema.parse(req.body);

  const temporaryPassword = body.password ?? randomUUID();
  const cleanUsername = body.username.trim().toLowerCase();

  const created = await prisma.$transaction(async (tx) => {
    let gestorId: string | null = null;
    if (body.role === 'GESTOR') {
      const gestor = await tx.gestor.create({
        data: {
          name: usernameToGestorName(cleanUsername),
        },
      });
      gestorId = gestor.id;
    }

    return tx.user.create({
      data: {
        username: cleanUsername,
        email: `${cleanUsername}@local.user`,
        name: cleanUsername,
        role: body.role,
        gestorId,
        isActive: body.isActive ?? true,
        authProvider: 'LOCAL',
        externalAuthId: null,
        password: await hashPassword(temporaryPassword),
      },
      include: {
        gestor: {
          select: { id: true, name: true, legajo: true },
        },
      },
    });
  });

  res.status(201).json({
    user: toUserResponse(created),
    temporaryPassword: body.password ? undefined : temporaryPassword,
  });
});

router.patch('/users/:id', async (req: AuthRequest, res: Response) => {
  const id = z.string().uuid('ID invalido').parse(req.params.id);
  const body = updateUserSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  if (req.user?.userId === id) {
    if (body.isActive === false) {
      res.status(400).json({ error: 'No puedes desactivar tu propio usuario.' });
      return;
    }
    if (body.role && body.role !== 'ADMIN') {
      res.status(400).json({ error: 'No puedes quitarte el rol ADMIN a ti mismo.' });
      return;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const nextRole = body.role ?? existing.role;
    const nextUsername = body.username?.trim().toLowerCase();
    const nextEmail = nextUsername ? `${nextUsername}@local.user` : undefined;
    let nextGestorId = existing.gestorId;

    if (nextRole === 'GESTOR') {
      if (!nextGestorId) {
        const gestor = await tx.gestor.create({
          data: {
            name: usernameToGestorName(nextUsername ?? existing.username ?? existing.name),
          },
        });
        nextGestorId = gestor.id;
      } else if (nextUsername) {
        await tx.gestor.update({
          where: { id: nextGestorId },
          data: { name: usernameToGestorName(nextUsername) },
        });
      }
    } else {
      nextGestorId = null;
    }

    return tx.user.update({
      where: { id },
      data: {
        ...(nextUsername !== undefined
          ? { username: nextUsername, name: nextUsername, email: nextEmail }
          : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(nextGestorId !== existing.gestorId ? { gestorId: nextGestorId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.password ? { password: await hashPassword(body.password) } : {}),
      },
      include: {
        gestor: {
          select: { id: true, name: true, legajo: true },
        },
      },
    });
  });

  res.json(toUserResponse(updated));
});

router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  const id = z.string().uuid('ID invalido').parse(req.params.id);

  if (req.user?.userId === id) {
    res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  const assignedEvaluations = await prisma.evaluation.count({
    where: { auditorId: id, deletedAt: null },
  });

  if (assignedEvaluations > 0) {
    res.status(400).json({
      error:
        'No se puede eliminar: el usuario tiene evaluaciones asociadas. Desactivalo en su lugar.',
    });
    return;
  }

  await prisma.user.delete({ where: { id } });
  res.json({ message: 'Usuario eliminado correctamente' });
});

export default router;
