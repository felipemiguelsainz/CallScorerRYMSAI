import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

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

type ScoreFieldKey = (typeof SCORE_FIELD_KEYS)[number];

function toJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getAudioHash(aiRaw: unknown): string | null {
  const raw = toJsonObject(aiRaw);
  const hash = raw?.audio_sha256;
  return typeof hash === 'string' && hash.trim() ? hash.trim() : null;
}

function hasScoringPayload(aiRaw: unknown): boolean {
  const raw = toJsonObject(aiRaw);
  const scores = raw ? toJsonObject(raw.scores) : null;
  return !!scores && Object.keys(scores).length > 0;
}

function pickScoreFields(source: Record<string, unknown>): Record<string, unknown> {
  return SCORE_FIELD_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = source[key as ScoreFieldKey];
    return acc;
  }, {});
}

async function main() {
  const evaluations = await prisma.evaluation.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });

  const groups = new Map<string, typeof evaluations>();
  for (const evaluation of evaluations) {
    const hash = getAudioHash(evaluation.ai_scoring_raw);
    if (!hash) continue;
    const list = groups.get(hash) ?? [];
    list.push(evaluation);
    groups.set(hash, list);
  }

  let updated = 0;
  for (const [hash, group] of groups.entries()) {
    if (group.length < 2) continue;

    const canonical =
      group.find(
        (item) => hasScoringPayload(item.ai_scoring_raw) && Number(item.score_total) > 0,
      ) ??
      group.find((item) => hasScoringPayload(item.ai_scoring_raw)) ??
      group[0];

    const canonicalRaw = toJsonObject(canonical.ai_scoring_raw) ?? {};

    for (const item of group) {
      if (item.id === canonical.id) continue;

      const nextRaw = {
        ...canonicalRaw,
        audio_sha256: hash,
        normalized_from_evaluation_id: canonical.id,
      };

      await prisma.evaluation.update({
        where: { id: item.id },
        data: {
          ...pickScoreFields(canonical as unknown as Record<string, unknown>),
          score_core: canonical.score_core,
          score_basics: canonical.score_basics,
          score_total: canonical.score_total,
          ai_scoring_raw: JSON.parse(JSON.stringify(nextRaw)) as Prisma.InputJsonValue,
        },
      });

      updated += 1;
    }
  }

  console.log(`Normalized ${updated} evaluations across ${groups.size} audio hash groups.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
