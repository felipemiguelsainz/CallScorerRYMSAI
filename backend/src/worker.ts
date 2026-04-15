import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { env } from './config/env';
import prisma from './lib/prisma';
import { logger } from './lib/logger';
import * as whisperService from './services/whisper.service';

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

    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: {
        transcript,
        transcript_json,
        audio_duration_s: duration_s,
        processing_state: 'READY',
      },
    });
  },
  { connection: { url: env.REDIS_URL } },
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'audio-processing job completed');
});

worker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'audio-processing job failed');
  const evaluationId = (job?.data as { evaluationId?: string })?.evaluationId;
  if (evaluationId) {
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { processing_state: 'ERROR' },
    });
  }
});

logger.info('Audio processing worker started');
