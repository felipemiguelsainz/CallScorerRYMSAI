import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    redisClient.on('error', (err) => {
      logger.warn({ err }, 'Redis client error');
    });
  }

  return redisClient;
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const cached = await getRedisClient().get(key);
    return cached ? (JSON.parse(cached) as T) : null;
  } catch (error) {
    logger.warn({ err: error, key }, 'Could not read cache key');
    return null;
  }
}

export async function setCachedJson<T>(key: string, ttlSeconds: number, value: T): Promise<void> {
  try {
    await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    logger.warn({ err: error, key }, 'Could not write cache key');
  }
}
