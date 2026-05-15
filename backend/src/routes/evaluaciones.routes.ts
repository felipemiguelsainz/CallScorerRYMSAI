import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { upload, uploadBulk, assertMp3MimeType } from '../middleware/upload.middleware';
import { uploadAudioLimiter } from '../middleware/rate-limit.middleware';
import { filterByUserScope } from '../middleware/scope.middleware';
import prisma from '../lib/prisma';
import * as scoringService from '../services/scoring.service';
import * as debtorService from '../services/debtor-analysis.service';
import * as pdfService from '../services/pdf.service';
import { sanitizeObjectStrings } from '../lib/sanitize';
import { invalidateCachePattern } from '../lib/redis';
import { storageProvider } from '../modules/storage/local-storage-provider';
import { enqueueAudioProcessingJob } from '../modules/audio-processing/queue';
import { logger } from '../lib/logger';
import { env } from '../config/env';

const router = Router();
router.use(authMiddleware);
router.use(filterByUserScope);

// Evaluation lifecycle: create -> upload audio -> async transcription -> scoring -> debtor analysis.

const uuidSchema = z.string().uuid('ID inválido');

router.param('id', (req, res, next, value) => {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: 'ID inválido' });
    return;
  }
  next();
});

const SCORE_FIELD_KEYS = [
  'ea_preg_motivo_atraso',
  'ea_sondea_capacidad_pago',
  'ea_utiliza_informacion',
  'res_neg_sentido_urgencia',
  'res_negociacion_total_rr',
  'res_ofrece_herramienta',
  'prev_consecuencias_beneficios',
  'core_apertura',
  'core_control',
  'core_cierre',
  'herr_sigue_politicas',
  'herr_explica_ofrecidas',
  'herr_ofrece_pex',
  'doc_codifica',
  'doc_gestiones_ant',
  'doc_act_demograficos',
  'bas_identificacion',
  'bas_informacion',
  'bas_respeto',
  'bas_veracidad',
] as const;

const createEvaluacionSchema = z.object({
  gestorId: z.string().uuid(),
  clienteId: z.string().uuid().optional(),
  account_number: z.string().max(50).optional(),
  assignment_number: z.string().max(50).optional(),
  contact_type: z.enum(['TITULAR', 'TERCERO', 'NO_CONTACTO']).optional(),
  assignment_date: z.string().datetime().optional(),
  call_id: z.string().max(100).optional(),
});

const updateEvaluacionSchema = z.object({
  transcript: z.string().max(200000).optional(),
  observaciones: z.string().max(10000).optional(),
  contact_type: z.enum(['TITULAR', 'TERCERO', 'NO_CONTACTO']).optional(),
  ea_preg_motivo_atraso: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  ea_sondea_capacidad_pago: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  ea_utiliza_informacion: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  res_neg_sentido_urgencia: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  res_negociacion_total_rr: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  res_ofrece_herramienta: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  prev_consecuencias_beneficios: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  core_apertura: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  core_control: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  core_cierre: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  herr_sigue_politicas: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  herr_explica_ofrecidas: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  herr_ofrece_pex: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  doc_codifica: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  doc_gestiones_ant: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  doc_act_demograficos: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  bas_identificacion: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  bas_informacion: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  bas_respeto: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  bas_veracidad: z.enum(['CUMPLE', 'NO_CUMPLE', 'NO_APLICA']).optional(),
  flag_llamada_cortada: z.boolean().optional(),
  flag_problema_calidad: z.boolean().optional(),
  flag_problema_sonido: z.boolean().optional(),
  flag_sistema_lento: z.boolean().optional(),
  flag_conectividad: z.boolean().optional(),
  flag_empatia_covid: z.boolean().optional(),
});

// ─── BULK UPLOAD ──────────────────────────────────────────────────────────────
router.post(
  '/bulk',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  uploadBulk.array('files', 100),
  async (req: AuthRequest, res: Response) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) {
      res.status(400).json({ error: 'No se recibieron archivos' });
      return;
    }

    const { gestorId, clienteId } = req.body as { gestorId?: string; clienteId?: string };
    if (!gestorId) {
      await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined)));
      res.status(400).json({ error: 'gestorId es requerido' });
      return;
    }

    const gestor = await prisma.gestor.findFirst({ where: { id: gestorId, deletedAt: null } });
    if (!gestor) {
      await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined)));
      res.status(404).json({ error: 'Gestor no encontrado' });
      return;
    }

    // Expand ZIPs into individual MP3 entries
    type Mp3Entry = { originalName: string; diskPath: string; tempFromZip: boolean };
    const mp3Entries: Mp3Entry[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.zip') {
        try {
          const zip = new AdmZip(file.path);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            const entryExt = path.extname(entry.entryName).toLowerCase();
            const audioExts = new Set(['.gsm', '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.flac']);
            if (!audioExts.has(entryExt)) continue;
            const baseName = path.basename(entry.entryName);
            const tempPath = path.join(env.UPLOADS_DIR, `${uuidv4()}-${Date.now()}${entryExt}`);
            zip.extractEntryTo(entry, path.dirname(tempPath), false, true, false, path.basename(tempPath));
            mp3Entries.push({ originalName: baseName, diskPath: tempPath, tempFromZip: true });
          }
        } catch (err) {
          logger.warn({ err, file: file.originalname }, 'bulk: failed to extract ZIP');
        } finally {
          await fs.unlink(file.path).catch(() => undefined);
        }
      } else {
        mp3Entries.push({ originalName: file.originalname, diskPath: file.path, tempFromZip: false });
      }
    }

    const results: { call_id: string; id?: string; status: 'queued' | 'skipped' | 'error'; reason?: string }[] = [];

    for (const entry of mp3Entries) {
      const callId = path.basename(entry.originalName, path.extname(entry.originalName)).slice(0, 100);

      const existing = await prisma.evaluation.findFirst({ where: { call_id: callId, deletedAt: null } });
      if (existing) {
        await fs.unlink(entry.diskPath).catch(() => undefined);
        results.push({ call_id: callId, status: 'skipped', reason: 'call_id duplicado' });
        continue;
      }

      try {
        await assertMp3MimeType(entry.diskPath);
      } catch {
        await fs.unlink(entry.diskPath).catch(() => undefined);
        results.push({ call_id: callId, status: 'error', reason: 'Archivo no es un MP3 válido' });
        continue;
      }

      try {
        const filename = `${uuidv4()}-${Date.now()}.mp3`;
        const storedPath = await storageProvider.upload(entry.diskPath, filename);

        const evaluation = await prisma.evaluation.create({
          data: {
            call_id: callId,
            account_number: 'PENDING',
            assignment_number: 'PENDING',
            contact_type: 'NO_CONTACTO',
            assignment_date: new Date(),
            gestorId,
            ...(clienteId ? { clienteId } : {}),
            auditorId: req.user!.userId,
            audio_filename: filename,
            audio_path: storedPath,
            processing_state: 'PENDING',
          },
        });

        await enqueueAudioProcessingJob({ evaluationId: evaluation.id, filePath: storedPath });

        results.push({ call_id: callId, id: evaluation.id, status: 'queued' });
      } catch (err) {
        logger.error({ err, callId }, 'bulk: failed to create evaluation');
        await fs.unlink(entry.diskPath).catch(() => undefined);
        results.push({ call_id: callId, status: 'error', reason: 'Error interno' });
      }
    }

    res.status(207).json({ results });
  },
);

router.get('/', async (req: AuthRequest, res: Response) => {
  const { status, minScore, limit = '20', cursor, gestorId, clienteId, fechaDesde, fechaHasta } = req.query as Record<string, string>;
  const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  if (cursor) {
    const parsedCursor = uuidSchema.safeParse(cursor);
    if (!parsedCursor.success) {
      res.status(400).json({ error: 'Cursor inválido' });
      return;
    }
  }

  const where: Prisma.EvaluationWhereInput = {
    deletedAt: null,
    ...(req.scopeFilter ?? {}),
    ...(status ? { status: status as Prisma.EnumEvaluationStatusFilter['equals'] } : {}),
    ...(minScore ? { score_total: { gte: new Prisma.Decimal(minScore) } } : {}),
    // gestorId filter only applies if user is not GESTOR (scope already handles that)
    ...(gestorId && req.user?.role !== 'GESTOR' ? { gestorId } : {}),
    ...(clienteId ? { clienteId } : {}),
    ...((fechaDesde || fechaHasta) ? {
      capture_date: {
        ...(fechaDesde ? { gte: new Date(fechaDesde) } : {}),
        ...(fechaHasta ? { lte: new Date(fechaHasta) } : {}),
      },
    } : {}),
  };

  const data = await prisma.evaluation.findMany({
    where,
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      gestor: { select: { id: true, name: true, legajo: true } },
      auditor: { select: { id: true, name: true, email: true } },
      cliente: { select: { id: true, nombre: true, icono: true } },
      debtor_analysis: {
        select: {
          id: true,
          justificacion_tipo: true,
          promesa_de_pago: true,
          nivel_conflicto: true,
          monto_adeudado: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const hasNext = data.length > take;
  const page = hasNext ? data.slice(0, take) : data;
  const total = await prisma.evaluation.count({ where });

  res.json({
    data: page,
    nextCursor: hasNext ? page[page.length - 1].id : null,
    total,
  });
});

router.post(
  '/',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const cleanBody = sanitizeObjectStrings(req.body);
    const body = createEvaluacionSchema.parse(cleanBody);

    const gestor = await prisma.gestor.findFirst({ where: { id: body.gestorId, deletedAt: null } });
    if (!gestor) {
      res.status(404).json({ error: 'Gestor no encontrado' });
      return;
    }

    const callId = body.call_id ?? `CALL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const existing = await prisma.evaluation.findUnique({ where: { call_id: callId } });
    if (existing) {
      res.status(409).json({ error: 'call_id duplicado' });
      return;
    }

    const evaluacion = await prisma.evaluation.create({
      data: {
        call_id: callId,
        account_number: body.account_number ?? 'PENDING',
        assignment_number: body.assignment_number ?? 'PENDING',
        contact_type: body.contact_type ?? 'NO_CONTACTO',
        assignment_date: body.assignment_date ? new Date(body.assignment_date) : new Date(),
        gestorId: body.gestorId,
        ...(body.clienteId ? { clienteId: body.clienteId } : {}),
        auditorId: req.user!.userId,
        audio_filename: '',
        audio_path: '',
        processing_state: 'PENDING',
      },
    });

    res.status(201).json(evaluacion);
  },
);

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const evaluacion = await prisma.evaluation.findFirst({
    where: {
      id: req.params.id,
      deletedAt: null,
      ...(req.scopeFilter ?? {}),
    },
    include: {
      gestor: true,
      auditor: { select: { id: true, name: true, email: true } },
      debtor_analysis: true,
    },
  });

  if (!evaluacion) {
    res.status(404).json({ error: 'Evaluaci�n no encontrada' });
    return;
  }

  res.json(evaluacion);
});

router.get('/:id/status', async (req: AuthRequest, res: Response) => {
  const evaluation = await prisma.evaluation.findFirst({
    where: { id: req.params.id, deletedAt: null, ...(req.scopeFilter ?? {}) },
    select: { processing_state: true, transcript: true, score_total: true, debtor_analysis: { select: { nivel_conflicto: true } } },
  });

  if (!evaluation) {
    res.status(404).json({ error: 'Evaluaci�n no encontrada' });
    return;
  }

  let status: 'processing' | 'ready' | 'error' = 'processing';
  if (evaluation.processing_state === 'READY') status = 'ready';
  if (evaluation.processing_state === 'ERROR') status = 'error';

  res.json({
    status,
    ...(status === 'ready' ? {
      score_total: evaluation.score_total ? Number(evaluation.score_total) : 0,
      nivel_conflicto: evaluation.debtor_analysis?.nivel_conflicto ?? null,
    } : {}),
  });
});

router.put(
  '/:id',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const cleanBody = sanitizeObjectStrings(req.body);
    const body = updateEvaluacionSchema.parse(cleanBody);

    const existing = await prisma.evaluation.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(req.scopeFilter ?? {}),
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Evaluaci�n no encontrada' });
      return;
    }

    const updatedData: Record<string, unknown> = { ...body };
    const mergedEval = { ...existing, ...body };

    if (hasScoreFields(body)) {
      const { score_core, score_basics, score_total } = scoringService.calculateScores(
        mergedEval as Parameters<typeof scoringService.calculateScores>[0],
      );
      updatedData.score_core = score_core;
      updatedData.score_basics = score_basics;
      updatedData.score_total = score_total;
    }

    const evaluacion = await prisma.evaluation.update({
      where: { id: req.params.id },
      data: updatedData,
      include: {
        gestor: true,
        auditor: { select: { id: true, name: true, email: true } },
        debtor_analysis: true,
      },
    });

    res.json(evaluacion);
  },
);

router.delete('/:id', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const existing = await prisma.evaluation.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!existing) {
    res.status(404).json({ error: 'Evaluaci�n no encontrada' });
    return;
  }

  await prisma.evaluation.delete({ where: { id: req.params.id } });
  await invalidateCachePattern('dashboard:*');
  res.json({ message: 'Evaluación eliminada' });
});

router.post('/:id/requeue', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  const existing = await prisma.evaluation.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!existing) {
    res.status(404).json({ error: 'Evaluación no encontrada' });
    return;
  }
  if (!existing.audio_path) {
    res.status(400).json({ error: 'Sin archivo de audio para reprocesar.' });
    return;
  }

  await prisma.evaluation.update({
    where: { id: req.params.id },
    data: { processing_state: 'PENDING', transcript: null, transcript_json: Prisma.JsonNull, score_total: 0, score_core: 0, score_basics: 0 },
  });

  await enqueueAudioProcessingJob({ evaluationId: req.params.id, filePath: existing.audio_path });
  res.json({ message: 'Evaluación reencolada para reprocesamiento.' });
});

router.post(
  '/:id/upload-audio',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  uploadAudioLimiter,
  upload.single('audio'),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No se recibi� archivo de audio' });
      return;
    }

    const existing = await prisma.evaluation.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
        ...(req.scopeFilter ?? {}),
      },
    });

    if (!existing) {
      await fs.unlink(req.file.path).catch(() => undefined);
      res.status(404).json({ error: 'Evaluaci�n no encontrada' });
      return;
    }

    try {
      await assertMp3MimeType(req.file.path);
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => undefined);
      throw error;
    }

    const storedPath = await storageProvider.upload(req.file.path, req.file.filename);

    // Marking as PENDING guarantees worker-driven processing is the source of truth.
    await prisma.evaluation.update({
      where: { id: req.params.id },
      data: {
        audio_filename: req.file.filename,
        audio_path: storedPath,
        processing_state: 'PENDING',
        transcript: null,
        transcript_json: Prisma.JsonNull,
      },
    });

    const queued = await enqueueAudioProcessingJob({
      evaluationId: req.params.id,
      filePath: storedPath,
    });

    if (!queued) {
      res.status(202).json({
        message:
          'Audio recibido, pero la cola no est\u00e1 disponible. Reintente cuando Redis est\u00e9 activo.',
        processing_state: 'PENDING',
      });
      return;
    }

    res
      .status(202)
      .json({ message: 'Audio recibido. Procesamiento en cola.', processing_state: 'PENDING' });
  },
);

router.post(
  '/:id/score',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const existing = await prisma.evaluation.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(req.scopeFilter ?? {}) },
    });

    if (!existing) {
      res.status(404).json({ error: 'Evaluaci�n no encontrada' });
      return;
    }
    if (!existing.transcript) {
      res.status(400).json({ error: 'La evaluaci�n a�n no tiene transcripci�n lista.' });
      return;
    }

    const force = req.query.force === 'true';

    // Same audio => same score. Reuse reduces AI cost and keeps consistency across duplicates.
    // Skip reuse when force=true (e.g. after a scoring prompt update).
    const audioSha256 = existing.audio_path ? await hashFileSha256(existing.audio_path) : null;
    if (audioSha256 && !force) {
      const reusableCandidates = await prisma.evaluation.findMany({
        where: {
          id: { not: req.params.id },
          deletedAt: null,
          ai_scoring_raw: {
            path: ['audio_sha256'],
            equals: audioSha256,
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      });

      const reusableEvaluation = reusableCandidates.find((candidate) =>
        hasScoringPayload(candidate.ai_scoring_raw),
      );

      if (reusableEvaluation) {
        const reusedRaw = {
          ...(toJsonObject(reusableEvaluation.ai_scoring_raw) ?? {}),
          audio_sha256: audioSha256,
          reused_from_evaluation_id: reusableEvaluation.id,
        };

        const evaluacion = await prisma.evaluation.update({
          where: { id: req.params.id },
          data: {
            ...pickScoreFields(reusableEvaluation),
            score_core: reusableEvaluation.score_core,
            score_basics: reusableEvaluation.score_basics,
            score_total: reusableEvaluation.score_total,
            ai_scoring_raw: JSON.parse(JSON.stringify(reusedRaw)) as Prisma.InputJsonValue,
          },
          include: {
            gestor: true,
            auditor: { select: { id: true, name: true, email: true } },
            debtor_analysis: true,
          },
        });

        res.json({ message: 'Scoring reutilizado por audio idéntico', evaluacion });
        return;
      }
    }

    const { scores, raw } = await scoringService.scoreWithGPT(existing.transcript);
    const { score_core, score_basics, score_total, breakdown } =
      scoringService.calculateScores(scores);
    const normalizedTranscript =
      typeof raw.transcript_used_for_scoring === 'string' ? raw.transcript_used_for_scoring : null;
    const persistedRaw = {
      ...raw,
      ...(audioSha256 ? { audio_sha256: audioSha256 } : {}),
      calculation: {
        formula:
          'score_total = core * 0.50 + basics * 0.35 + other * 0.15; cada bloque se calcula sobre criterios aplicables (CUMPLE / (CUMPLE + NO_CUMPLE)).',
        breakdown,
      },
    };
    const persistedRawJson = JSON.parse(JSON.stringify(persistedRaw)) as Prisma.InputJsonValue;

    const evaluacion = await prisma.evaluation.update({
      where: { id: req.params.id },
      data: {
        ...scores,
        score_core,
        score_basics,
        score_total,
        ai_scoring_raw: persistedRawJson,
        ...(normalizedTranscript ? { transcript: normalizedTranscript } : {}),
      },
      include: {
        gestor: true,
        auditor: { select: { id: true, name: true, email: true } },
        debtor_analysis: true,
      },
    });

    res.json({ message: 'Scoring completado', evaluacion });
  },
);

router.post(
  '/:id/analyze-debtor',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const existing = await prisma.evaluation.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(req.scopeFilter ?? {}) },
      include: { debtor_analysis: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Evaluaci�n no encontrada' });
      return;
    }

    if (!existing.transcript) {
      res.status(400).json({ error: 'La evaluaci�n no tiene transcripci�n.' });
      return;
    }

    const { analysis, raw } = await debtorService.analyzeDebtor(existing.transcript);

    // Upsert debtor analysis atomically to avoid partial writes between tables.
    const evaluacion = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (existing.debtor_analysis) {
        await tx.debtorAnalysis.update({
          where: { evaluationId: req.params.id },
          data: { ...analysis, ai_raw_response: raw },
        });
      } else {
        await tx.debtorAnalysis.create({
          data: { evaluationId: req.params.id, ...analysis, ai_raw_response: raw },
        });
      }

      return tx.evaluation.findUnique({
        where: { id: req.params.id },
        include: {
          gestor: true,
          auditor: { select: { id: true, name: true, email: true } },
          debtor_analysis: true,
        },
      });
    });

    res.json({ message: 'An�lisis del deudor completado', evaluacion });
  },
);

router.post(
  '/:id/complete',
  requireRole('AUDITOR', 'SUPERVISOR', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const existing = await prisma.evaluation.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(req.scopeFilter ?? {}) },
    });

    if (!existing) {
      res.status(404).json({ error: 'Evaluaci�n no encontrada' });
      return;
    }

    const evaluacion = await prisma.evaluation.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED' },
    });

    res.json({ message: 'Evaluaci�n completada', evaluacion });
  },
);

router.get('/:id/export-pdf', async (req: AuthRequest, res: Response) => {
  const evaluacion = await prisma.evaluation.findFirst({
    where: { id: req.params.id, deletedAt: null, ...(req.scopeFilter ?? {}) },
    include: {
      gestor: true,
      auditor: { select: { id: true, name: true, email: true } },
      debtor_analysis: true,
    },
  });
  if (!evaluacion) {
    res.status(404).json({ error: 'Evaluaci�n no encontrada' });
    return;
  }

  const pdfBuffer = await pdfService.generateEvaluationPDF(evaluacion);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="evaluacion-${evaluacion.call_id}.pdf"`,
  );
  res.send(pdfBuffer);
});

function hasScoreFields(body: Record<string, unknown>): boolean {
  return SCORE_FIELD_KEYS.some((k) => k in body);
}

function pickScoreFields(evaluation: Record<string, unknown>): Record<string, unknown> {
  return SCORE_FIELD_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = evaluation[key];
    return acc;
  }, {});
}

function toJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasScoringPayload(value: unknown): boolean {
  const raw = toJsonObject(value);
  const scores = raw ? toJsonObject(raw.scores) : null;
  return !!scores && Object.keys(scores).length > 0;
}

async function hashFileSha256(filePath: string): Promise<string | null> {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export default router;

// ─── BATCH RESCORE ────────────────────────────────────────────────────────────
// Exported separately so it can be mounted at a different path if needed.
export const batchRescoreRouter = Router();
batchRescoreRouter.use(authMiddleware);

batchRescoreRouter.post(
  '/rescore-all',
  requireRole('ADMIN', 'SUPERVISOR'),
  async (req: AuthRequest, res: Response) => {
    // Respond immediately; re-score runs in background.
    const evaluaciones = await prisma.evaluation.findMany({
      where: { deletedAt: null, transcript: { not: null } },
      select: { id: true, transcript: true, audio_path: true },
    });

    res.json({ message: `Reevaluando ${evaluaciones.length} evaluaciones en segundo plano.`, total: evaluaciones.length });

    // Fire-and-forget: re-score each evaluation sequentially to avoid hammering OpenAI.
    (async () => {
      let done = 0;
      for (const ev of evaluaciones) {
        try {
          const { scores, raw } = await scoringService.scoreWithGPT(ev.transcript!);
          const { score_core, score_basics, score_total, breakdown } = scoringService.calculateScores(scores);
          const audioSha256 = ev.audio_path ? await hashFileSha256(ev.audio_path) : null;
          const persistedRaw = {
            ...raw,
            ...(audioSha256 ? { audio_sha256: audioSha256 } : {}),
            calculation: {
              formula: 'score_total = core * 0.50 + basics * 0.35 + other * 0.15; cada bloque se calcula sobre criterios aplicables.',
              breakdown,
            },
          };
          await prisma.evaluation.update({
            where: { id: ev.id },
            data: { ...scores, score_core, score_basics, score_total, ai_scoring_raw: JSON.parse(JSON.stringify(persistedRaw)) },
          });
          done++;
        } catch (err) {
          logger.error({ evaluationId: ev.id, err }, '[batch-rescore] Error en evaluación');
        }
      }
      logger.info({ done, total: evaluaciones.length }, '[batch-rescore] Completado');
    })().catch(console.error);
  },
);
