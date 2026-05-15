import OpenAI from 'openai';
import { logger } from '../lib/logger';

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

export interface PreAnalysis {
  call_type: 'TITULAR' | 'TERCERO' | 'NO_CONTACTO' | string;
  call_outcome: string;
  notes?: string;
}

export type FlagValue = 'SI' | 'NO_APLICA';

export interface CallFlags {
  llamada_cortada: FlagValue;
  problema_sonido: FlagValue;
  problema_conectividad: FlagValue;
  problema_calidad_audio: FlagValue;
  sistema_lento: FlagValue;
  empatia_covid: FlagValue;
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
  total_applicable: number;
  is_scoreable: boolean;
  breakdown: ScoreBreakdown;
}

export interface ScoreResult {
  scores: ScoringFields;
  pre_analysis?: PreAnalysis;
  flags: CallFlags;
  raw: Record<string, unknown>;
}

const CORE_FIELDS: (keyof ScoringFields)[] = ['core_apertura', 'core_control', 'core_cierre'];
const BASICS_FIELDS: (keyof ScoringFields)[] = [
  'bas_identificacion',
  'bas_informacion',
  'bas_respeto',
  'bas_veracidad',
];
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

const MIN_APPLICABLE_THRESHOLD = 5;
const MAX_TRANSCRIPT_CHARS = 100_000;

const SCORING_PROMPT = `Eres un evaluador experto en cobranza para "Recuperos y Mandatos".
Analizá la transcripción de una llamada y evaluá los 20 criterios de la rúbrica oficial.

La transcripción usa "GESTOR:" para el agente de cobranza y "DEUDOR:" para la persona que atiende.
Evaluá ÚNICAMENTE las acciones y conductas del GESTOR.

Para cada criterio asigná: CUMPLE / NO_CUMPLE / NO_APLICA.
Usá NO_APLICA solo cuando el criterio realmente no aplica al contexto de la llamada.
Hacé el esfuerzo de evaluar con lo que haya en la transcripción: no uses NO_APLICA como excusa
para no puntuar. Si hay diálogo real, evaluá.

════════════════════════════════════════════════
PASO 1 — PRE-ANÁLISIS (antes de puntuar)
════════════════════════════════════════════════

Determiná:
  • call_type — ¿con quién habló el gestor?
      "TITULAR"    : habló directamente con el deudor
      "TERCERO"    : habló con un familiar, conocido u otra persona que no es el deudor
      "NO_CONTACTO": no hubo contacto real (no atendió, buzón de voz, número incorrecto, cortó al instante)

  • call_outcome — una frase breve del resultado
      Ej: "acuerdo de pago parcial para el viernes", "negativa a pagar", "dejó mensaje en buzón"

════════════════════════════════════════════════
PASO 2 — REGLAS AUTOMÁTICAS POR TIPO DE CONTACTO
════════════════════════════════════════════════

SI call_type = "NO_CONTACTO":
  → Todos los criterios de ACCIÓN = NO_APLICA
  → Criterios de CONDUCTA (bas_respeto, bas_veracidad, herr_sigue_politicas, core_control,
    res_neg_sentido_urgencia) = CUMPLE (no hay evidencia negativa)
  → Excepción: si el gestor dejó un mensaje de voz con contenido, evaluá core_apertura normalmente

SI call_type = "TERCERO":
  → NO_APLICA automático para: ea_preg_motivo_atraso, ea_sondea_capacidad_pago,
    ea_utiliza_informacion, res_negociacion_total_rr, res_ofrece_herramienta,
    prev_consecuencias_beneficios, herr_ofrece_pex, doc_act_demograficos
  → Evaluá normalmente: core_apertura, core_control, core_cierre, bas_identificacion,
    bas_informacion, bas_respeto, bas_veracidad, herr_sigue_politicas, herr_explica_ofrecidas,
    doc_codifica, doc_gestiones_ant, res_neg_sentido_urgencia

════════════════════════════════════════════════
PASO 3 — LÓGICA DE EVALUACIÓN
════════════════════════════════════════════════

CRITERIOS DE ACCIÓN — el gestor debía ejecutar algo concreto:
  → Si no lo hizo: NO_CUMPLE (la omisión es evidencia suficiente)
  → Si no corresponde según Paso 2: NO_APLICA

CRITERIOS DE CONDUCTA — evalúan comportamiento sostenido durante toda la llamada:
  → PRESUME CUMPLE por defecto. Solo NO_CUMPLE ante evidencia explícita e inequívoca.
  Aplica a: bas_respeto, bas_veracidad, herr_sigue_politicas, core_control, res_neg_sentido_urgencia

════════════════════════════════════════════════
PASO 4 — RÚBRICA OFICIAL
════════════════════════════════════════════════

━━━ 1. ESCUCHA ACTIVA ━━━

ea_preg_motivo_atraso [ACCIÓN]
  ¿El agente indagó por qué el cliente no pagó en tiempo y forma?
  NO_CUMPLE: va directo a cobrar o negociar sin preguntar el motivo del atraso.

ea_sondea_capacidad_pago [ACCIÓN]
  ¿El agente exploró cuánto, cuándo y cómo puede pagar el cliente?
  NO_CUMPLE: solo informa el monto adeudado sin explorar la capacidad de pago.

ea_utiliza_informacion [ACCIÓN]
  ¿El agente usó datos previos del cliente (historial, acuerdos, perfil)?
  NO_CUMPLE: gestiona sin ninguna referencia al historial cuando este debería existir.

━━━ 2. RESOLUCIÓN ━━━

res_neg_sentido_urgencia [CONDUCTA]
  ¿El agente transmitió urgencia y negoció con firmeza respetuosa?
  CUMPLE por defecto. NO_CUMPLE SOLO si cede completamente sin negociar o muestra total desinterés.

res_negociacion_total_rr [ACCIÓN]
  ¿El agente intentó negociar el total de la deuda o una refinanciación completa?
  NO_CUMPLE: solo menciona la deuda o acepta pagos parciales sin intentar la regularización total.

res_ofrece_herramienta [ACCIÓN]
  ¿La herramienta o plan ofrecido fue acorde a la situación del cliente?
  NO_CUMPLE: solo exige el pago sin ofrecer ninguna alternativa, herramienta o plan.

━━━ 3. PREVENCIÓN ━━━

prev_consecuencias_beneficios [ACCIÓN]
  ¿El agente informó consecuencias de no pagar (mora, juicio, inhabilitación) y/o beneficios
  de regularizar (quita, cuotas, descuentos)?
  NO_CUMPLE: negocia sin mencionar ninguna consecuencia ni beneficio concreto.

━━━ 4. ESTRUCTURA — CORE (peso 50%) ━━━

core_apertura [ACCIÓN]
  ¿El agente se presentó con nombre, empresa y motivo de llamada de forma clara?
  NO_CUMPLE: no dice su nombre, no menciona la empresa, o no aclara el motivo.

core_control [CONDUCTA]
  ¿El agente mantuvo el hilo conductor sin perder el foco del objetivo?
  CUMPLE por defecto. NO_CUMPLE SOLO si pierde completamente el control de la conversación.

core_cierre [ACCIÓN]
  ¿El agente confirmó acuerdos, próximos pasos y se despidió correctamente?
  NO_CUMPLE: corta abruptamente, no confirma acuerdos, o no hay despedida formal.

━━━ 5. HERRAMIENTAS ━━━

herr_sigue_politicas [CONDUCTA]
  ¿El agente respetó los protocolos y políticas de cobranza vigentes?
  CUMPLE por defecto. NO_CUMPLE SOLO ante incumplimiento evidente: condiciones no autorizadas,
  divulgación de información confidencial, violación de la privacidad del deudor.

herr_explica_ofrecidas [ACCIÓN]
  ¿El agente explicó claramente las herramientas disponibles (planes, descuentos, modos de pago)?
  NO_CUMPLE: solo menciona que hay opciones sin explicarlas, o no las menciona.

herr_ofrece_pex [ACCIÓN]
  ¿El agente ofreció la herramienta Pex cuando correspondía según el perfil del deudor?
  NO_APLICA: si el perfil claramente no aplica (deuda judicial, monto incompatible con Pex).
  NO_CUMPLE: corresponde ofrecerlo según el perfil pero no lo menciona.

━━━ 6. DOCUMENTACIÓN ━━━

doc_codifica [ACCIÓN]
  ¿El agente registró correctamente el resultado de la gestión en el sistema?
  NO_APLICA (por defecto): salvo que el gestor lo mencione explícitamente en la llamada.
  NO_CUMPLE: el gestor dice explícitamente que NO va a registrar o que no puede hacerlo.

doc_gestiones_ant [ACCIÓN]
  ¿El agente consultó y consideró el historial de gestiones previas del cliente?
  NO_CUMPLE: actúa sin referencias al historial cuando este debería consultarse.

doc_act_demograficos [ACCIÓN]
  ¿El agente actualizó o verificó datos demográficos del cliente (teléfono, dirección)?
  NO_APLICA: si no hubo necesidad ni oportunidad de actualizar datos en esta llamada.
  NO_CUMPLE: había oportunidad clara de verificar/actualizar datos y no lo hizo.

━━━ 7. COMPLIANCE — BASICS (peso 35%) ━━━

bas_identificacion [ACCIÓN]
  ¿El agente verificó la identidad del interlocutor antes de brindar información?
  NO_CUMPLE: brinda montos o datos de la deuda sin verificar quién es.

bas_informacion [ACCIÓN]
  ¿La información sobre la deuda fue correcta, completa y verificable?
  NO_CUMPLE: da montos incorrectos, nombre equivocado, o información contradictoria.

bas_respeto [CONDUCTA]
  ¿El agente mantuvo tono respetuoso sin presión indebida durante toda la llamada?
  CUMPLE por defecto. NO_CUMPLE SOLO ante insultos, amenazas explícitas, gritos, acoso o coerción.
  NO es violación: tono firme, urgencia, insistencia respetuosa. Ante la menor duda: CUMPLE.

bas_veracidad [CONDUCTA]
  ¿El agente evitó información falsa y promesas que no puede cumplir?
  CUMPLE por defecto. NO_CUMPLE SOLO ante mentira o dato incorrecto verificable en la transcripción.

════════════════════════════════════════════════
PASO 5 — FLAGS DE LA LLAMADA
════════════════════════════════════════════════

Indicá "SI" o "NO_APLICA" para cada uno, según lo que se evidencie en la transcripción:
  • llamada_cortada         — la llamada se cortó de forma abrupta o incompleta
  • problema_sonido         — hubo problemas de sonido (eco, voz entrecortada, volumen)
  • problema_conectividad   — hubo problemas de conexión/señal
  • problema_calidad_audio  — la calidad del audio dificultó la comprensión
  • sistema_lento           — el gestor mencionó lentitud o demoras del sistema
  • empatia_covid           — el gestor mostró empatía relacionada con COVID
Los flags son informativos y NO afectan el puntaje.

════════════════════════════════════════════════
FORMATO DE RESPUESTA
════════════════════════════════════════════════

Respondé ÚNICAMENTE con JSON válido. Sin texto antes ni después del JSON.

{
  "pre_analysis": {
    "call_type": "TITULAR|TERCERO|NO_CONTACTO",
    "call_outcome": "descripción breve del resultado de la llamada",
    "notes": "observaciones relevantes (opcional, omitir si no hay nada relevante)"
  },
  "scores": {
    "ea_preg_motivo_atraso": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "ea_sondea_capacidad_pago": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "ea_utiliza_informacion": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "res_neg_sentido_urgencia": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "res_negociacion_total_rr": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "res_ofrece_herramienta": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "prev_consecuencias_beneficios": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "core_apertura": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "core_control": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "core_cierre": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "herr_sigue_politicas": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "herr_explica_ofrecidas": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "herr_ofrece_pex": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "doc_codifica": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "doc_gestiones_ant": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "doc_act_demograficos": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "bas_identificacion": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "bas_informacion": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "bas_respeto": "CUMPLE|NO_CUMPLE|NO_APLICA",
    "bas_veracidad": "CUMPLE|NO_CUMPLE|NO_APLICA"
  },
  "flags": {
    "llamada_cortada": "SI|NO_APLICA",
    "problema_sonido": "SI|NO_APLICA",
    "problema_conectividad": "SI|NO_APLICA",
    "problema_calidad_audio": "SI|NO_APLICA",
    "sistema_lento": "SI|NO_APLICA",
    "empatia_covid": "SI|NO_APLICA"
  },
  "justifications": {
    "ea_preg_motivo_atraso": "Motivo en ≤12 palabras. Cita: 'GESTOR: ...'",
    "ea_sondea_capacidad_pago": "...",
    "ea_utiliza_informacion": "...",
    "res_neg_sentido_urgencia": "...",
    "res_negociacion_total_rr": "...",
    "res_ofrece_herramienta": "...",
    "prev_consecuencias_beneficios": "...",
    "core_apertura": "...",
    "core_control": "...",
    "core_cierre": "...",
    "herr_sigue_politicas": "...",
    "herr_explica_ofrecidas": "...",
    "herr_ofrece_pex": "...",
    "doc_codifica": "...",
    "doc_gestiones_ant": "...",
    "doc_act_demograficos": "...",
    "bas_identificacion": "...",
    "bas_informacion": "...",
    "bas_respeto": "...",
    "bas_veracidad": "..."
  }
}`;

const VALID_VALUES = ['CUMPLE', 'NO_CUMPLE', 'NO_APLICA'] as const;

function validateScoreValue(val: unknown): ScoreValue {
  if (typeof val === 'string' && VALID_VALUES.includes(val as ScoreValue)) {
    return val as ScoreValue;
  }
  return 'NO_APLICA';
}

function validateFlagValue(val: unknown): FlagValue {
  return typeof val === 'string' && val.toUpperCase().replace(/\s+/g, '_') === 'SI'
    ? 'SI'
    : 'NO_APLICA';
}

function parseFlags(raw: unknown): CallFlags {
  const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    llamada_cortada: validateFlagValue(f.llamada_cortada),
    problema_sonido: validateFlagValue(f.problema_sonido),
    problema_conectividad: validateFlagValue(f.problema_conectividad),
    problema_calidad_audio: validateFlagValue(f.problema_calidad_audio),
    sistema_lento: validateFlagValue(f.sistema_lento),
    empatia_covid: validateFlagValue(f.empatia_covid),
  };
}

export async function scoreWithGPT(transcript: string): Promise<ScoreResult> {
  const normalizedTranscript = await normalizeTranscriptForScoring(transcript);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1',
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

  const parsedPreAnalysis =
    parsed.pre_analysis && typeof parsed.pre_analysis === 'object'
      ? (parsed.pre_analysis as Record<string, unknown>)
      : undefined;

  const preAnalysis: PreAnalysis | undefined = parsedPreAnalysis
    ? {
        call_type: String(parsedPreAnalysis.call_type ?? ''),
        call_outcome: String(parsedPreAnalysis.call_outcome ?? ''),
        notes: parsedPreAnalysis.notes ? String(parsedPreAnalysis.notes) : undefined,
      }
    : undefined;

  const flags = parseFlags(parsed.flags);

  logger.info({ call_type: preAnalysis?.call_type }, 'scoring pre-analysis');

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
    pre_analysis: preAnalysis,
    scores,
    flags,
    justifications,
    modelOutput: parsed,
  };

  return { scores, pre_analysis: preAnalysis, flags, raw: normalizedRaw };
}

async function normalizeTranscriptForScoring(transcript: string): Promise<string> {
  if (!transcript?.trim()) return transcript;

  const truncated =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[TRANSCRIPCIÓN TRUNCADA]'
      : transcript;

  const hasDialogueLabels = /GESTOR:|DEUDOR:/i.test(truncated);
  if (hasDialogueLabels) return truncated;

  // Transcript lacks speaker labels — attempt attribution via gpt-4o
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Sos un experto en análisis de llamadas de cobranza telefónica saliente (outbound).
Tu tarea es tomar una transcripción cruda (sin etiquetas de hablante) y agregarle las etiquetas GESTOR y DEUDOR.

REGLA FUNDAMENTAL: Esta es una llamada SALIENTE de cobranza. El GESTOR llama al DEUDOR.
EL GESTOR SIEMPRE HABLA PRIMERO. La primera línea de diálogo es SIEMPRE del GESTOR.

GESTOR (agente de cobranza): se presenta, menciona la empresa y la deuda, hace preguntas sobre el pago, ofrece planes y herramientas, insiste en regularizar.
DEUDOR (persona que atiende): responde, da excusas, pregunta montos, acepta o rechaza propuestas.

Formato: una intervención por línea, "GESTOR: texto" o "DEUDOR: texto".
Devolvé ÚNICAMENTE el diálogo etiquetado, sin comentarios.`,
        },
        {
          role: 'user',
          content: `Transcripción sin etiquetas:\n\n${truncated}`,
        },
      ],
    });

    const formatted = completion.choices[0].message.content?.trim();
    if (!formatted) return truncated;

    const hasLabels = /^(GESTOR|DEUDOR):/m.test(formatted);
    if (!hasLabels) return truncated;

    // Detect swapped speakers: first line must be GESTOR
    const firstLine = formatted.split('\n').find((l) => /^(GESTOR|DEUDOR):/i.test(l.trim()));
    if (firstLine && /^DEUDOR:/i.test(firstLine.trim())) {
      logger.warn('normalizeTranscriptForScoring: first speaker is DEUDOR, swapping labels');
      return formatted
        .replace(/^GESTOR:/gm, '__SWAP__:')
        .replace(/^DEUDOR:/gm, 'GESTOR:')
        .replace(/^__SWAP__:/gm, 'DEUDOR:');
    }

    return formatted;
  } catch (err) {
    logger.warn({ err }, 'normalizeTranscriptForScoring: speaker attribution failed, using raw');
    return truncated;
  }
}

/**
 * Calculate weighted scores.
 * CORE (apertura, control, cierre) = 50% weight
 * BASICS (identificacion, informacion, respeto, veracidad) = 35% weight
 * Remaining = 15% weight
 * Buckets with zero applicable criteria are excluded and their weight is redistributed.
 */
export function calculateScores(eval_: Partial<ScoringFields>): CalculatedScores {
  const core = calculateBucket(eval_, 'CORE', 0.5, CORE_FIELDS);
  const basics = calculateBucket(eval_, 'BASICS', 0.35, BASICS_FIELDS);
  const other = calculateBucket(eval_, 'RESTO', 0.15, OTHER_FIELDS);

  const total_applicable = core.applicable + basics.applicable + other.applicable;

  const applicableBuckets = [core, basics, other].filter((bucket) => bucket.applicable > 0);
  const totalApplicableWeight = applicableBuckets.reduce((sum, bucket) => sum + bucket.weight, 0);

  const normalizedWeights = {
    core:
      totalApplicableWeight === 0 || core.applicable === 0
        ? 0
        : core.weight / totalApplicableWeight,
    basics:
      totalApplicableWeight === 0 || basics.applicable === 0
        ? 0
        : basics.weight / totalApplicableWeight,
    other:
      totalApplicableWeight === 0 || other.applicable === 0
        ? 0
        : other.weight / totalApplicableWeight,
  };

  const weightedTotal = applicableBuckets.reduce((sum, bucket) => {
    if (bucket.score === null) return sum;
    return sum + bucket.score * (bucket.weight / totalApplicableWeight);
  }, 0);

  return {
    score_core: roundScore(core.score ?? 0),
    score_basics: roundScore(basics.score ?? 0),
    score_total: roundScore(totalApplicableWeight === 0 ? 0 : weightedTotal),
    total_applicable,
    is_scoreable: total_applicable >= MIN_APPLICABLE_THRESHOLD,
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

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundWeight(value: number): number {
  return Math.round(value * 10000) / 10000;
}
