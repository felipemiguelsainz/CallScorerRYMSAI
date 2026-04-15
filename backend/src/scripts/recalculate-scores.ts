import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { Prisma } from '@prisma/client';
import fs from 'fs/promises';
import prisma from '../lib/prisma';
import { calculateScores, ScoringFields } from '../services/scoring.service';

function buildPersistedRaw(
  existingRaw: unknown,
  breakdown: ReturnType<typeof calculateScores>['breakdown'],
  audioSha256: string | null,
): Prisma.InputJsonValue {
  const source =
    existingRaw && typeof existingRaw === 'object' ? (existingRaw as Record<string, unknown>) : {};
  const persistedRaw = {
    ...source,
    ...(audioSha256 ? { audio_sha256: audioSha256 } : {}),
    calculation: {
      formula:
        'score_total = core * 0.50 + basics * 0.35 + other * 0.15; cada bloque se calcula sobre criterios aplicables (CUMPLE / (CUMPLE + NO_CUMPLE)).',
      breakdown,
    },
  };

  return JSON.parse(JSON.stringify(persistedRaw)) as Prisma.InputJsonValue;
}

async function main() {
  const evaluations = await prisma.evaluation.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      audio_path: true,
      ai_scoring_raw: true,
      ea_preg_motivo_atraso: true,
      ea_sondea_capacidad_pago: true,
      ea_utiliza_informacion: true,
      res_neg_sentido_urgencia: true,
      res_negociacion_total_rr: true,
      res_ofrece_herramienta: true,
      prev_consecuencias_beneficios: true,
      core_apertura: true,
      core_control: true,
      core_cierre: true,
      herr_sigue_politicas: true,
      herr_explica_ofrecidas: true,
      herr_ofrece_pex: true,
      doc_codifica: true,
      doc_gestiones_ant: true,
      doc_act_demograficos: true,
      bas_identificacion: true,
      bas_informacion: true,
      bas_respeto: true,
      bas_veracidad: true,
    },
  });

  let updated = 0;

  for (const evaluation of evaluations) {
    const scoringFields: ScoringFields = {
      ea_preg_motivo_atraso: evaluation.ea_preg_motivo_atraso,
      ea_sondea_capacidad_pago: evaluation.ea_sondea_capacidad_pago,
      ea_utiliza_informacion: evaluation.ea_utiliza_informacion,
      res_neg_sentido_urgencia: evaluation.res_neg_sentido_urgencia,
      res_negociacion_total_rr: evaluation.res_negociacion_total_rr,
      res_ofrece_herramienta: evaluation.res_ofrece_herramienta,
      prev_consecuencias_beneficios: evaluation.prev_consecuencias_beneficios,
      core_apertura: evaluation.core_apertura,
      core_control: evaluation.core_control,
      core_cierre: evaluation.core_cierre,
      herr_sigue_politicas: evaluation.herr_sigue_politicas,
      herr_explica_ofrecidas: evaluation.herr_explica_ofrecidas,
      herr_ofrece_pex: evaluation.herr_ofrece_pex,
      doc_codifica: evaluation.doc_codifica,
      doc_gestiones_ant: evaluation.doc_gestiones_ant,
      doc_act_demograficos: evaluation.doc_act_demograficos,
      bas_identificacion: evaluation.bas_identificacion,
      bas_informacion: evaluation.bas_informacion,
      bas_respeto: evaluation.bas_respeto,
      bas_veracidad: evaluation.bas_veracidad,
    };

    const { score_core, score_basics, score_total, breakdown } = calculateScores(scoringFields);
    const audioSha256 = await hashFileSha256(evaluation.audio_path);

    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: {
        score_core,
        score_basics,
        score_total,
        ai_scoring_raw: buildPersistedRaw(evaluation.ai_scoring_raw, breakdown, audioSha256),
      },
    });

    updated += 1;
  }

  console.log(`Recalculated ${updated} evaluations.`);
}

async function hashFileSha256(filePath: string): Promise<string | null> {
  if (!filePath) return null;

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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
