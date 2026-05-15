import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { Prisma } from '@prisma/client';
import { env } from './config/env';
import prisma from './lib/prisma';
import { logger } from './lib/logger';
import * as whisperService from './services/whisper.service';
import * as scoringService from './services/scoring.service';
import * as debtorService from './services/debtor-analysis.service';
import { enqueueAudioProcessingJob } from './modules/audio-processing/queue';

dotenv.config();

const worker = new Worker(
  'audio-processing',
  async (job) => {
    const { evaluationId, filePath } = job.data as { evaluationId: string; filePath: string };

    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { processing_state: 'PROCESSING' },
    });

    const { transcript, transcript_json, duration_s } =
      await whisperService.transcribeAudio(filePath);

    // Persist transcript before scoring so it's never lost on failure
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { transcript, transcript_json, audio_duration_s: duration_s },
    });

    // Scoring and debtor analysis are independent — run in parallel
    const [scoringOut, debtorOut] = await Promise.all([
      scoringService.scoreWithGPT(transcript),
      debtorService.analyzeDebtor(transcript),
    ]);

    const { scores, raw } = scoringOut;
    const { score_core, score_basics, score_total, breakdown } =
      scoringService.calculateScores(scores);

    const normalizedTranscript =
      typeof raw.transcript_used_for_scoring === 'string' ? raw.transcript_used_for_scoring : null;

    const persistedRaw = {
      ...raw,
      calculation: {
        formula:
          'score_total = core * 0.50 + basics * 0.35 + other * 0.15; cada bloque se calcula sobre criterios aplicables (CUMPLE / (CUMPLE + NO_CUMPLE)).',
        breakdown,
      },
    };

    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: {
        ...scores,
        score_core,
        score_basics,
        score_total,
        ai_scoring_raw: JSON.parse(JSON.stringify(persistedRaw)) as Prisma.InputJsonValue,
        ...(normalizedTranscript ? { transcript: normalizedTranscript } : {}),
      },
    });

    await prisma.debtorAnalysis.upsert({
      where: { evaluationId },
      create: { evaluationId, ...debtorOut.analysis, ai_raw_response: debtorOut.raw },
      update: { ...debtorOut.analysis, ai_raw_response: debtorOut.raw },
    });

    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { processing_state: 'READY' },
    });
  },
  { connection: { url: env.REDIS_URL }, concurrency: env.WORKER_CONCURRENCY },
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'audio-processing job completed');
});

// Bulk upload must never surface an error: when a job exhausts its retries
// (usually a transient OpenAI rate limit), auto-requeue it after a delay so it
// keeps retrying on its own. Only a job that fails ~50 times is given up on.
const MAX_REQUEUES = 8;

worker.on('failed', async (job, err) => {
  logger.error(
    { jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message },
    'audio-processing job attempt failed',
  );
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 5;
  // `failed` fires on every attempt — act only once all retries are exhausted.
  if (job.attemptsMade < maxAttempts) return;

  const data = job.data as { evaluationId?: string; filePath?: string; requeueCount?: number };
  const { evaluationId, filePath, requeueCount = 0 } = data;
  if (!evaluationId || !filePath) return;

  if (requeueCount < MAX_REQUEUES) {
    logger.warn(
      { evaluationId, requeueCount },
      'job exhausted retries — auto-requeuing in 2 min',
    );
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { processing_state: 'PROCESSING' },
    });
    await enqueueAudioProcessingJob(
      { evaluationId, filePath, requeueCount: requeueCount + 1 },
      { delay: 120_000 },
    );
    return;
  }

  // Extremely rare: failed ~50 times across requeues — give up.
  logger.error({ evaluationId }, 'job failed permanently after all requeues');
  await prisma.evaluation.update({
    where: { id: evaluationId },
    data: { processing_state: 'ERROR' },
  });
});

logger.info('Audio processing worker started');
