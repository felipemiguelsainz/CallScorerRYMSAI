/**
 * auth.service.ts
 *
 * Interface designed for easy replacement with MSAL.js + Azure AD.
 * Currently implements JWT-based auth with bcrypt passwords.
 *
 * Future Azure AD swap: replace login() with MSAL token validation,
 * and getMe() with Microsoft Graph /me call.
 */
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { signAccessToken, signRefreshToken, verifyToken } from './token.service';

// Precomputed bcrypt hash used to equalize timing when the user does not exist.
const DUMMY_PASSWORD_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.Og5kM90oCbGyF/F7fs/3Gzdh0dX8GKa';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function throwInvalidCredentials(): Promise<never> {
  // Small jitter makes automated credential stuffing less efficient.
  const jitterMs = 120 + Math.floor(Math.random() * 130);
  await sleep(jitterMs);
  throw Object.assign(new Error('Credenciales inválidas'), { status: 401 });
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string | null;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
    authProvider: string;
    externalAuthId: string | null;
  };
}

export async function login(identifier: string, password: string): Promise<LoginResult> {
  const cleanIdentifier = identifier.trim();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: cleanIdentifier, mode: 'insensitive' } },
        { email: { equals: cleanIdentifier, mode: 'insensitive' } },
      ],
    },
  });
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return throwInvalidCredentials();
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid || !user.isActive) {
    return throwInvalidCredentials();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    gestorId: user.gestorId ?? undefined,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      authProvider: user.authProvider,
      externalAuthId: user.externalAuthId,
    },
  };
}

export async function rotateRefreshToken(refreshToken: string): Promise<LoginResult> {
  const payload = verifyToken(refreshToken);
  if (payload.tokenType !== 'refresh') {
    throw Object.assign(new Error('Refresh token inválido'), { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    throw Object.assign(new Error('Usuario no encontrado'), { status: 401 });
  }

  if (!user.isActive) {
    throw Object.assign(new Error('Tu usuario está desactivado. Contacta al administrador.'), { status: 403 });
  }

  const cleanPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    gestorId: user.gestorId ?? undefined,
  };

  const newAccessToken = signAccessToken(cleanPayload);
  const newRefreshToken = signRefreshToken(cleanPayload);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      authProvider: user.authProvider,
      externalAuthId: user.externalAuthId,
    },
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      authProvider: true,
      externalAuthId: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });
  if (!user) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  if (!user.isActive) throw Object.assign(new Error('Usuario desactivado'), { status: 403 });
  return user;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
