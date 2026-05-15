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

const AUDIO_EXTS = new Set(['.gsm', '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.flac']);

const storage = multer.diskStorage({
  destination: (_req: Request, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req: Request, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.gsm';
    cb(null, `${uuidv4()}-${Date.now()}${ext}`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (AUDIO_EXTS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Formato no soportado. Formatos válidos: ${[...AUDIO_EXTS].join(', ')}`));
  }
}

// GSM files have no standard magic bytes — validate only by extension.
export async function assertAudioFile(filePath: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) {
    throw Object.assign(new Error('El archivo no es un audio válido'), { status: 400 });
  }
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    throw Object.assign(new Error('El archivo de audio no es accesible'), { status: 400 });
  }
}

// Keep old name as alias so existing imports don't break.
export const assertMp3MimeType = assertAudioFile;

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

function bulkFileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (AUDIO_EXTS.has(ext) || ext === '.zip') {
    cb(null, true);
  } else {
    cb(new Error(`Solo se aceptan archivos de audio o .zip`));
  }
}

const bulkStorage = multer.diskStorage({
  destination: (_req: Request, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req: Request, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}-${Date.now()}${ext}`);
  },
});

export const uploadBulk = multer({
  storage: bulkStorage,
  fileFilter: bulkFileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
});
