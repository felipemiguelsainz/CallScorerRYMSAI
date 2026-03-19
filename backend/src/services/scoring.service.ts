import OpenAI from 'openai';

export type ScoreValue = 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 120_000,
});

export interface ScoringFields {
  ea_preg_motivo_atraso: ScoreValue;
  ea_sondea_capacidad_pago: ScoreValue;
  ea_utiliza_informacion: ScoreValue;
  res_neg_sentido_urgencia: ScoreValue;
  res_negociacion_total_rr: ScoreValue;
  res_ofrece_herramienta: ScoreValue;
  prev_consecuencias_beneficios: ScoreValue;
  core_apertura: ScoreValue;
  core_control: ScoreValue;
  core_cierre: ScoreValue;
  herr_sigue_politicas: ScoreValue;
  herr_explica_ofrecidas: ScoreValue;
  herr_ofrece_pex: ScoreValue;
  doc_codifica: ScoreValue;
  doc_gestiones_ant: ScoreValue;
  doc_act_demograficos: ScoreValue;
  bas_identificacion: ScoreValue;
  bas_informacion: ScoreValue;
  bas_respeto: ScoreValue;
  bas_veracidad: ScoreValue;
}

export interface ScoreBucketBreakdown {
  label: string;
  weight: number;
  applicable: number;
  cumple: number;
  no_cumple: number;
  no_aplica: number;
  score: number | null;
}

export interface ScoreBreakdown {
  core: ScoreBucketBreakdown;
  basics: ScoreBucketBreakdown;
  other: ScoreBucketBreakdown;
  normalized_weights: {
    core: number;
    basics: number;
    other: number;
  };
}

export interface CalculatedScores {
  score_core: number;
  score_basics: number;
  score_total: number;
  breakdown: ScoreBreakdown;
}

const CORE_FIELDS: (keyof ScoringFields)[] = ['core_apertura', 'core_control', 'core_cierre'];
const BASICS_FIELDS: (keyof ScoringFields)[] = ['bas_identificacion', 'bas_informacion', 'bas_respeto', 'bas_veracidad'];
const OTHER_FIELDS: (keyof ScoringFields)[] = [
  'ea_preg_motivo_atraso',
  'ea_sondea_capacidad_pago',
  'ea_utiliza_informacion',
  'res_neg_sentido_urgencia',
  'res_negociacion_total_rr',
  'res_ofrece_herramienta',
  'prev_consecuencias_beneficios',
  'herr_sigue_politicas',
  'herr_explica_ofrecidas',
  'herr_ofrece_pex',
  'doc_codifica',
  'doc_gestiones_ant',
  'doc_act_demograficos',
];

export interface ScoreResult {
  scores: ScoringFields;
  raw: Record<string, unknown>;
}

const SCORING_PROMPT = `Eres un evaluador experto en cobranza para la empresa "Recuperos y Mandatos".
Analiza la siguiente transcripción de una llamada de cobranza y evalúa cada ítem de la rúbrica.

La transcripción está en formato diálogo con líneas "GESTOR:" y "DEUDOR:". Evalúa SOLO lo dicho por el GESTOR.
Si no hay evidencia explícita en el diálogo del GESTOR, NO debe marcarse como CUMPLE.

Para cada ítem, responde EXACTAMENTE con uno de estos valores:
- "CUMPLE": El gestor cumplió correctamente con el criterio
- "NO_CUMPLE": El gestor NO cumplió con el criterio
- "NO_APLICA": El criterio no aplica para esta llamada

Reglas estrictas para auditoría:
- Usa NO_APLICA solo cuando el criterio sea verdaderamente imposible de evaluar por naturaleza de la llamada (ej: no hubo contacto efectivo).
- Si hubo contacto y el gestor no evidencia la conducta, marcar NO_CUMPLE.
- No otorgues beneficio de la duda.
- Cada justificación debe incluir una cita breve del diálogo (máximo 12 palabras) con prefijo GESTOR: o DEUDOR:.
- Formato recomendado por criterio: "Motivo breve. Cita: 'GESTOR: ...'".

RÚBRICA DE EVALUACIÓN:

ESCUCHA ACTIVA:
- ea_preg_motivo_atraso: ¿El gestor preguntó el motivo del atraso?
- ea_sondea_capacidad_pago: ¿El gestor sondeó la capacidad de pago del deudor?
- ea_utiliza_informacion: ¿El gestor utilizó la información del deudor para negociar?

RESOLUCIÓN:
- res_neg_sentido_urgencia: ¿El gestor negoció con sentido de urgencia?
- res_negociacion_total_rr: ¿Se negoció la totalidad de la deuda/recupero?
- res_ofrece_herramienta: ¿El gestor ofreció herramientas de pago?

PREVENCIÓN:
- prev_consecuencias_beneficios: ¿El gestor explicó consecuencias de no pagar y beneficios de regularizar?

ESTRUCTURA / CORE (peso 50%):
- core_apertura: ¿El gestor realizó una apertura correcta (identificación, empresa, motivo)?
- core_control: ¿El gestor mantuvo el control de la llamada?
- core_cierre: ¿El gestor realizó un cierre efectivo (acuerdo, próximos pasos)?

HERRAMIENTAS:
- herr_sigue_politicas: ¿El gestor siguió las políticas de cobranza?
- herr_explica_ofrecidas: ¿El gestor explicó claramente las herramientas ofrecidas?
- herr_ofrece_pex: ¿El gestor ofreció Plan de Extensión (PEX)?

DOCUMENTACIÓN:
- doc_codifica: ¿El gestor codificó correctamente la llamada?
- doc_gestiones_ant: ¿El gestor revisó o mencionó gestiones anteriores?
- doc_act_demograficos: ¿El gestor actualizó datos demográficos si fue necesario?

COMPLIANCE / BASICS (peso 35%):
- bas_identificacion: ¿El gestor se identificó correctamente?
- bas_informacion: ¿El gestor brindó información precisa y completa?
- bas_respeto: ¿El gestor trató al deudor con respeto durante toda la llamada?
- bas_veracidad: ¿El gestor fue veraz en toda la información proporcionada?

Responde ÚNICAMENTE con un objeto JSON válido usando este formato:
{
  "scores": {
    "...20 claves de la rúbrica...": "CUMPLE|NO_CUMPLE|NO_APLICA"
  },
  "justifications": {
    "...20 claves de la rúbrica...": "justificación breve basada en la transcripción"
  }
}

Si hubo contacto y falta evidencia explícita del criterio, usar NO_CUMPLE.
Usar NO_APLICA solo cuando el criterio sea realmente imposible de evaluar por la naturaleza de la llamada.
No incluyas texto adicional fuera del JSON.`;

const VALID_VALUES = ['CUMPLE', 'NO_CUMPLE', 'NO_APLICA'] as const;

function validateScoreValue(val: unknown): ScoreValue {
  if (typeof val === 'string' && VALID_VALUES.includes(val as ScoreValue)) {
    return val as ScoreValue;
  }
  return 'NO_APLICA';
}

export async function scoreWithGPT(transcript: string): Promise<ScoreResult> {
  const normalizedTranscript = await normalizeTranscriptForScoring(transcript);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SCORING_PROMPT },
      { role: 'user', content: `TRANSCRIPCIÓN:\n\n${normalizedTranscript}` },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content ?? '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const parsedScores =
    parsed.scores && typeof parsed.scores === 'object'
      ? (parsed.scores as Record<string, unknown>)
      : parsed;

  const justifications =
    parsed.justifications && typeof parsed.justifications === 'object'
      ? (parsed.justifications as Record<string, unknown>)
      : {};

  const scores: ScoringFields = {
    ea_preg_motivo_atraso: validateScoreValue(parsedScores.ea_preg_motivo_atraso),
    ea_sondea_capacidad_pago: validateScoreValue(parsedScores.ea_sondea_capacidad_pago),
    ea_utiliza_informacion: validateScoreValue(parsedScores.ea_utiliza_informacion),
    res_neg_sentido_urgencia: validateScoreValue(parsedScores.res_neg_sentido_urgencia),
    res_negociacion_total_rr: validateScoreValue(parsedScores.res_negociacion_total_rr),
    res_ofrece_herramienta: validateScoreValue(parsedScores.res_ofrece_herramienta),
    prev_consecuencias_beneficios: validateScoreValue(parsedScores.prev_consecuencias_beneficios),
    core_apertura: validateScoreValue(parsedScores.core_apertura),
    core_control: validateScoreValue(parsedScores.core_control),
    core_cierre: validateScoreValue(parsedScores.core_cierre),
    herr_sigue_politicas: validateScoreValue(parsedScores.herr_sigue_politicas),
    herr_explica_ofrecidas: validateScoreValue(parsedScores.herr_explica_ofrecidas),
    herr_ofrece_pex: validateScoreValue(parsedScores.herr_ofrece_pex),
    doc_codifica: validateScoreValue(parsedScores.doc_codifica),
    doc_gestiones_ant: validateScoreValue(parsedScores.doc_gestiones_ant),
    doc_act_demograficos: validateScoreValue(parsedScores.doc_act_demograficos),
    bas_identificacion: validateScoreValue(parsedScores.bas_identificacion),
    bas_informacion: validateScoreValue(parsedScores.bas_informacion),
    bas_respeto: validateScoreValue(parsedScores.bas_respeto),
    bas_veracidad: validateScoreValue(parsedScores.bas_veracidad),
  };

  const normalizedRaw: Record<string, unknown> = {
    transcript_used_for_scoring: normalizedTranscript,
    scores,
    justifications,
    modelOutput: parsed,
  };

  return { scores, raw: normalizedRaw };
}

async function normalizeTranscriptForScoring(transcript: string): Promise<string> {
  if (!transcript?.trim()) return transcript;

  const hasDialogueLabels = /GESTOR:|DEUDOR:/i.test(transcript);
  if (hasDialogueLabels) return transcript;

  // Deterministic fallback to avoid score drift between runs.
  return fallbackDialogueFormat(transcript);
}

/**
 * Calculate weighted scores.
 * CORE items (apertura, control, cierre) = 50% weight
 * BASICS items (identificacion, informacion, respeto, veracidad) = 35% weight
 * Remaining items = 15% weight
 */
export function calculateScores(eval_: Partial<ScoringFields>): CalculatedScores {
  const core = calculateBucket(eval_, 'CORE', 0.5, CORE_FIELDS);
  const basics = calculateBucket(eval_, 'BASICS', 0.35, BASICS_FIELDS);
  const other = calculateBucket(eval_, 'RESTO', 0.15, OTHER_FIELDS);

  const applicableBuckets = [core, basics, other].filter((bucket) => bucket.applicable > 0);
  const totalApplicableWeight = applicableBuckets.reduce((sum, bucket) => sum + bucket.weight, 0);

  const normalizedWeights = {
    core: totalApplicableWeight === 0 || core.applicable === 0 ? 0 : core.weight / totalApplicableWeight,
    basics: totalApplicableWeight === 0 || basics.applicable === 0 ? 0 : basics.weight / totalApplicableWeight,
    other: totalApplicableWeight === 0 || other.applicable === 0 ? 0 : other.weight / totalApplicableWeight,
  };

  const weightedTotal = applicableBuckets.reduce((sum, bucket) => {
    if (bucket.score === null) return sum;
    return sum + bucket.score * (bucket.weight / totalApplicableWeight);
  }, 0);

  return {
    score_core: roundScore(core.score ?? 0),
    score_basics: roundScore(basics.score ?? 0),
    score_total: roundScore(totalApplicableWeight === 0 ? 0 : weightedTotal),
    breakdown: {
      core,
      basics,
      other,
      normalized_weights: {
        core: roundWeight(normalizedWeights.core),
        basics: roundWeight(normalizedWeights.basics),
        other: roundWeight(normalizedWeights.other),
      },
    },
  };
}

function calculateBucket(
  eval_: Partial<ScoringFields>,
  label: string,
  weight: number,
  fields: (keyof ScoringFields)[],
): ScoreBucketBreakdown {
  const values = fields.map((field) => eval_[field]);
  const cumple = values.filter((value) => value === 'CUMPLE').length;
  const noCumple = values.filter((value) => value === 'NO_CUMPLE').length;
  const noAplica = values.filter((value) => value === 'NO_APLICA' || value == null).length;
  const applicable = cumple + noCumple;

  return {
    label,
    weight,
    applicable,
    cumple,
    no_cumple: noCumple,
    no_aplica: noAplica,
    score: applicable === 0 ? null : (cumple / applicable) * 100,
  };
}

function fallbackDialogueFormat(transcript: string): string {
  const normalized = transcript
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalized.length === 0) return transcript;

  const dialogue = normalized.map((line, index) => `${index % 2 === 0 ? 'GESTOR' : 'DEUDOR'}: ${line}`);
  return dialogue.join('\n');
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundWeight(value: number): number {
  return Math.round(value * 10000) / 10000;
}
