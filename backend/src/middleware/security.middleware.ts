import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env';

const allowedOrigins = env.FRONTEND_URL.split(',').map((v) => v.trim()).filter(Boolean);

export const helmetMiddleware = helmet({
  frameguard: { action: 'deny' },
  noSniff: true,
  hsts: env.NODE_ENV === 'production',
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...allowedOrigins],
    },
  },
});

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS origin not allowed'));
  },
  credentials: true,
});
