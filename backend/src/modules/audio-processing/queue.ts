import { Queue } from 'bullmq';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

export interface AudioProcessJob {
  evaluationId: string;
  filePath: string;
  requeueCount?: number;
}

let audioProcessingQueue: Queue<AudioProcessJob, unknown, string> | null = null;

function getQueue() {
  // Lazily initialize queue so startup does not fail if Redis is temporarily unavailable.
  if (!audioProcessingQueue) {
    audioProcessingQueue = new Queue<AudioProcessJob, unknown, string>('audio-processing', {
      connection: { url: env.REDIS_URL },
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 15000, // 15s→30s→60s→120s — outlasts OpenAI's 1-min TPM reset window
        },
        removeOnComplete: true,
      },
    });

    audioProcessingQueue.on('error', (error) => {
      logger.warn({ err: error }, 'audio-processing queue unavailable');
    });
  }

  return audioProcessingQueue;
}

export async function enqueueAudioProcessingJob(
  job: AudioProcessJob,
  opts?: { delay?: number },
): Promise<boolean> {
  try {
    await getQueue().add('process-audio', job, opts);
    return true;
  } catch (error) {
    // Route handlers rely on this boolean to gracefully degrade to pending state.
    logger.warn(
      { err: error, evaluationId: job.evaluationId },
      'could not enqueue audio-processing job',
    );
    return false;
  }
}
