import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { env } from '../config/env';

const UPLOADS_DIR = env.UPLOADS_DIR;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req: Request, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}.mp3`;
    cb(null, uniqueName);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const allowed = ['.mp3'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no soportado. Solo .mp3.'));
  }
}

export async function assertMp3MimeType(filePath: string): Promise<void> {
  const handle = await fs.promises.open(filePath, 'r');
  let header: Buffer;
  try {
    header = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 4) {
      throw Object.assign(new Error('El archivo no es un MP3 válido'), { status: 400 });
    }
    header = header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }

  const { fileTypeFromBuffer } = await import('file-type');
  const detectedType = await fileTypeFromBuffer(header);
  const allowedMimeTypes = new Set(['audio/mpeg', 'audio/mp3']);

  if (!detectedType || !allowedMimeTypes.has(detectedType.mime)) {
    throw Object.assign(new Error('El archivo no es un MP3 válido'), { status: 400 });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.mp3') {
    throw Object.assign(new Error('El archivo no es un MP3 válido'), { status: 400 });
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});
