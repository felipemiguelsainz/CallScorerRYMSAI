import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { upload, assertMp3MimeType } from '../middleware/upload.middleware';
import { uploadAudioLimiter } from '../middleware/rate-limit.middleware';
import { filterByUserScope } from '../middleware/scope.middleware';
import prisma from '../lib/prisma';
import * as scoringService from '../services/scoring.service';
import * as debtorService from '../services/debtor-analysis.service';
import * as pdfService from '../services/pdf.service';
import { sanitizeObjectStrings } from '../lib/sanitize';
import { storageProvider } from '../modules/storage/local-storage-provider';
import { enqueueAudioProcessingJob } from '../modules/audio-processing/queue';

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

router.get('/', async (req: AuthRequest, res: Response) => {
  const { status, minScore, limit = '20', cursor } = req.query as Record<string, string>;
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
  };

  const data = await prisma.evaluation.findMany({
    where,
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      gestor: { select: { id: true, name: true, legajo: true } },
      auditor: { select: { id: true, name: true, email: true } },
      debtor_analysis: {
        select: {
          id: true,
          justificacion_tipo: true,
          promesa_de_pago: true,
          nivel_conflicto: true,
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
    select: { processing_state: true, transcript: true },
  });

  if (!evaluation) {
    res.status(404).json({ error: 'Evaluaci�n no encontrada' });
    return;
  }

  let status: 'processing' | 'ready' | 'error' = 'processing';
  if (evaluation.processing_state === 'READY' || evaluation.transcript) status = 'ready';
  if (evaluation.processing_state === 'ERROR') status = 'error';

  res.json({ status });
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

  await prisma.evaluation.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ message: 'Evaluaci�n eliminada l�gicamente' });
});

router.post(
  '/:id/upload-audio',
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

router.post('/:id/transcribe', async (_req: AuthRequest, res: Response) => {
  res.status(400).json({ error: 'Endpoint deshabilitado: use upload-audio y status polling.' });
});

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

    // Same audio => same score. Reuse reduces AI cost and keeps consistency across duplicates.
    const audioSha256 = existing.audio_path ? await hashFileSha256(existing.audio_path) : null;
    if (audioSha256) {
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
