import { Queue } from 'bullmq';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

export interface AudioProcessJob {
  evaluationId: string;
  filePath: string;
}

let audioProcessingQueue: Queue<AudioProcessJob, unknown, string> | null = null;

function getQueue() {
  if (!audioProcessingQueue) {
    audioProcessingQueue = new Queue<AudioProcessJob, unknown, string>('audio-processing', {
      connection: { url: env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
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

export async function enqueueAudioProcessingJob(job: AudioProcessJob): Promise<boolean> {
  try {
    await getQueue().add('process-audio', job);
    return true;
  } catch (error) {
    logger.warn({ err: error, evaluationId: job.evaluationId }, 'could not enqueue audio-processing job');
    return false;
  }
}
