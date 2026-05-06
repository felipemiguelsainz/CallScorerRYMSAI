import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { reformatTranscriptDialogue } from '../services/whisper.service';
import { scoreWithGPT, calculateScores } from '../services/scoring.service';
import { analyzeDebtor } from '../services/debtor-analysis.service';

async function hashFile(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const evaluations = await prisma.evaluation.findMany({
    where: {
      deletedAt: null,
      transcript_json: { not: Prisma.JsonNull },
    },
    select: { id: true, call_id: true, transcript_json: true, audio_path: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Evaluaciones con transcript_json: ${evaluations.length}`);

  // Group by audio sha256 so the same audio is scored exactly once.
  const sha256Map = new Map<string, string>(); // sha256 -> call_id (canonical)
  const canonicalScores = new Map<string, {
    scores: object;
    score_core: unknown;
    score_basics: unknown;
    score_total: unknown;
    persistedRaw: object;
    transcript: string;
  }>();

  let done = 0;
  let reused = 0;
  let errors = 0;

  for (const ev of evaluations) {
    const json = ev.transcript_json as Record<string, unknown> | null;
    const rawText = typeof json?.text === 'string' ? json.text : null;

    if (!rawText) {
      console.log(`  ↷ ${ev.call_id} — sin texto en transcript_json, salteando`);
      continue;
    }

    const sha256 = await hashFile(ev.audio_path);

    try {
      // If we already scored an evaluation with this exact audio, reuse those scores.
      if (sha256 && canonicalScores.has(sha256)) {
        const canonical = canonicalScores.get(sha256)!;
        const reusedRaw = {
          ...canonical.persistedRaw,
          audio_sha256: sha256,
          reused_from_call_id: sha256Map.get(sha256),
        };

        await prisma.evaluation.update({
          where: { id: ev.id },
          data: {
            transcript: canonical.transcript,
            ...(canonical.scores as Record<string, unknown>),
            score_core: canonical.score_core as Prisma.Decimal,
            score_basics: canonical.score_basics as Prisma.Decimal,
            score_total: canonical.score_total as Prisma.Decimal,
            ai_scoring_raw: JSON.parse(JSON.stringify(reusedRaw)) as Prisma.InputJsonValue,
          },
        });

        // Also sync debtor analysis from the canonical
        const canonicalDebtor = await prisma.debtorAnalysis.findFirst({
          where: {
            evaluation: { call_id: sha256Map.get(sha256)! },
          },
        });
        if (canonicalDebtor) {
          const { id: _id, evaluationId: _evId, createdAt: _c, ai_raw_response, ...debtorData } = canonicalDebtor;
          const existingDebtor = await prisma.debtorAnalysis.findUnique({
            where: { evaluationId: ev.id },
            select: { id: true },
          });
          if (existingDebtor) {
            await prisma.debtorAnalysis.update({
              where: { evaluationId: ev.id },
              data: { ...debtorData, ai_raw_response: ai_raw_response as object },
            });
          } else {
            await prisma.debtorAnalysis.create({
              data: { evaluationId: ev.id, ...debtorData, ai_raw_response: ai_raw_response as object },
            });
          }
        }

        console.log(`  ↺ ${ev.call_id} — mismo audio que ${sha256Map.get(sha256)}, scores reutilizados`);
        reused++;
        continue;
      }

      console.log(`  ⟳ ${ev.call_id} — reformateando diálogo...`);
      const transcript = await reformatTranscriptDialogue(rawText);

      console.log(`  ⟳ ${ev.call_id} — re-scorando...`);
      const { scores, raw: scoringRaw } = await scoreWithGPT(transcript);
      const { score_core, score_basics, score_total, breakdown } = calculateScores(scores);

      const persistedRaw = {
        ...scoringRaw,
        ...(sha256 ? { audio_sha256: sha256 } : {}),
        calculation: {
          formula:
            'score_total = core * 0.50 + basics * 0.35 + other * 0.15; cada bloque se calcula sobre criterios aplicables.',
          breakdown,
        },
      };

      await prisma.evaluation.update({
        where: { id: ev.id },
        data: {
          transcript,
          ...scores,
          score_core,
          score_basics,
          score_total,
          ai_scoring_raw: JSON.parse(JSON.stringify(persistedRaw)) as Prisma.InputJsonValue,
        },
      });

      console.log(`  ⟳ ${ev.call_id} — analizando deudor...`);
      const { analysis, raw: debtorRaw } = await analyzeDebtor(transcript);

      const existingDebtor = await prisma.debtorAnalysis.findUnique({
        where: { evaluationId: ev.id },
        select: { id: true },
      });
      if (existingDebtor) {
        await prisma.debtorAnalysis.update({
          where: { evaluationId: ev.id },
          data: { ...analysis, ai_raw_response: debtorRaw as object },
        });
      } else {
        await prisma.debtorAnalysis.create({
          data: { evaluationId: ev.id, ...analysis, ai_raw_response: debtorRaw as object },
        });
      }

      if (sha256) {
        sha256Map.set(sha256, ev.call_id);
        canonicalScores.set(sha256, { scores, score_core, score_basics, score_total, persistedRaw, transcript });
      }

      console.log(
        `  ✓ ${ev.call_id} — score: ${score_total}, conflicto: ${analysis.nivel_conflicto}, monto: ${analysis.monto_adeudado ?? 'null'}`,
      );
      done++;
    } catch (err) {
      console.error(`  ✗ ${ev.call_id} — error:`, err);
      errors++;
    }
  }

  console.log(`\nListo: ${done} reprocesadas, ${reused} reutilizadas (mismo audio), ${errors} errores`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
