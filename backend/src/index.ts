import 'express-async-errors';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

dotenv.config();

import authRoutes from './routes/auth.routes';
import gestoresRoutes from './routes/gestores.routes';
import evaluacionesRoutes from './routes/evaluaciones.routes';
import dashboardRoutes from './routes/dashboard.routes';
import adminRoutes from './routes/admin.routes';
import { env } from './config/env';
import { apiLimiter } from './middleware/rate-limit.middleware';
import { corsMiddleware, helmetMiddleware } from './middleware/security.middleware';
import { httpLogger, logger } from './lib/logger';

const app = express();
const PORT = env.PORT;
const UPLOADS_DIR = env.UPLOADS_DIR;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(httpLogger);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(cookieParser());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/v1', apiLimiter);

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/gestores', gestoresRoutes);
app.use('/api/v1/evaluaciones', evaluacionesRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/admin', adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');

  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? 'Datos inválidos' });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'Conflicto por valor duplicado' });
    return;
  }

  if (err instanceof Error) {
    const status = (err as NodeJS.ErrnoException & { status?: number }).status ?? 500;
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Backend running');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});

export default app;
