import fs from 'fs/promises';
import path from 'path';
import { env } from '../../config/env';
import { StorageProvider } from './storage-provider';

export class LocalStorageProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(baseDir = env.UPLOADS_DIR) {
    this.baseDir = path.resolve(baseDir);
  }

  async upload(filePath: string, filename: string): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const targetPath = path.join(this.baseDir, filename);
    if (path.resolve(filePath) !== path.resolve(targetPath)) {
      await fs.copyFile(filePath, targetPath);
      await fs.unlink(filePath);
    }
    return targetPath;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(filePath).catch(() => undefined);
  }

  async getSignedUrl(filePath: string): Promise<string> {
    return filePath;
  }
}

export const storageProvider = new LocalStorageProvider();
