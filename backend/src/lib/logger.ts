import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'refreshToken',
      'accessToken',
      'OPENAI_API_KEY',
      'JWT_SECRET',
      'DATABASE_URL',
    ],
    remove: true,
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  customProps: (req, res) => ({
    action: `${req.method} ${req.url}`,
    ip: req.socket.remoteAddress,
    statusCode: res.statusCode,
  }),
});
