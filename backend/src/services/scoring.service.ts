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
  sufficient_content: boolean;
  notes?: string;
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

════════════════════════════════════════════════
PASO 1 — PRE-ANÁLISIS (OBLIGATORIO, antes de puntuar)
════════════════════════════════════════════════

Determiná:
  • call_type — ¿con quién habló el gestor?
      "TITULAR"    : habló directamente con el deudor
      "TERCERO"    : habló con un familiar, conocido u otra persona que no es el deudor
      "NO_CONTACTO": no hubo contacto real (no atendió, buzón de voz, número incorrecto, cortó al instante)

  • call_outcome — una frase breve del resultado
      Ej: "acuerdo de pago parcial para el viernes", "negativa a pagar", "dejó mensaje en buzón"

  • sufficient_content — ¿hay suficiente diálogo para evaluar?
      false si: duración < 30 segundos, llamada cortada sin gestión, solo saludo sin contenido evaluable

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
PASO 4 — RÚBRICA OFICIAL CON EJEMPLOS
════════════════════════════════════════════════

━━━ ESCUCHA ACTIVA ━━━

ea_preg_motivo_atraso [ACCIÓN]
  El gestor indaga activamente por qué el cliente no pagó en tiempo y forma.
  CUMPLE: "¿Por qué no pudo regularizar el vencimiento?" / "¿Qué pasó que no llegó a pagar?"
  NO_CUMPLE: Va directo a cobrar o negociar sin preguntar el motivo del atraso.

ea_sondea_capacidad_pago [ACCIÓN]
  El gestor explora concretamente qué puede pagar: cuánto, cuándo y cómo.
  CUMPLE: "¿Cuánto podría destinar esta semana?" / "¿Podría hacer algo hasta el viernes?"
  NO_CUMPLE: Solo informa el monto adeudado sin explorar la capacidad de pago del cliente.

ea_utiliza_informacion [ACCIÓN]
  El gestor usa datos previos del cliente (historial, acuerdos anteriores, perfil) durante la gestión.
  CUMPLE: "Veo que tenemos un acuerdo de marzo que no se cumplió..." / "Ya hablamos la semana pasada..."
  NO_CUMPLE: Trata la llamada sin ninguna referencia al historial cuando este debería existir.

━━━ RESOLUCIÓN ━━━

res_neg_sentido_urgencia [CONDUCTA]
  El gestor transmite urgencia en la regularización y negocia con firmeza respetuosa.
  CUMPLE por defecto. NO_CUMPLE SOLO si: cede completamente sin negociar, muestra total desinterés,
  o acepta cualquier condición sin insistir mínimamente.
  CUMPLE: "Necesitamos regularizar esto antes del cierre de mes" / "La deuda sigue generando mora"
  NO_CUMPLE: "Bueno, llámenos cuando pueda" sin ningún intento de avanzar.

res_negociacion_total_rr [ACCIÓN]
  El gestor intenta negociar el total de la deuda o una refinanciación completa.
  CUMPLE: Propone plan de cuotas, ofrece quita, negocia refinanciación del monto total.
  NO_CUMPLE: Solo menciona la deuda o acepta pagos parciales sin intentar la regularización total.

res_ofrece_herramienta [ACCIÓN]
  El gestor ofrece una herramienta o plan concreto acorde a la situación del cliente.
  CUMPLE: Ofrece cuotas, descuento por pago único, extensión de plazo, facilidades.
  NO_CUMPLE: Solo exige el pago sin ofrecer ninguna alternativa, herramienta o plan.

━━━ PREVENCIÓN ━━━

prev_consecuencias_beneficios [ACCIÓN]
  El gestor informa consecuencias de no pagar (mora, juicio, inhabilitación) y/o beneficios de
  regularizar (quita, cuotas, descuentos).
  CUMPLE: "Si no regulariza antes del 15, pasa a estado judicial" / "Pagando hoy tiene 20% de descuento"
  NO_CUMPLE: Negocia sin mencionar ninguna consecuencia ni beneficio concreto.

━━━ ESTRUCTURA — CORE (peso 50%) ━━━

core_apertura [ACCIÓN]
  El gestor se presenta correctamente: nombre, empresa y motivo de la llamada de forma clara.
  CUMPLE: "Hola, soy [nombre] de Recuperos y Mandatos, le llamo por una deuda pendiente con [empresa]"
  NO_CUMPLE: No dice su nombre, no menciona la empresa, o no aclara el motivo de la llamada.

core_control [CONDUCTA]
  El gestor mantiene el hilo conductor de la llamada sin perder el foco en el objetivo de cobro.
  CUMPLE por defecto. NO_CUMPLE SOLO si pierde completamente el control de la conversación
  o es manipulado por el deudor sin recuperar el objetivo principal de la llamada.

core_cierre [ACCIÓN]
  El gestor cierra confirmando acuerdos o próximos pasos y se despide correctamente.
  CUMPLE: "Entonces quedamos en que el viernes deposita $X, ¿correcto? Muy bien, hasta luego."
  NO_CUMPLE: Corta abruptamente, no confirma acuerdos, o no hay despedida formal.

━━━ HERRAMIENTAS ━━━

herr_sigue_politicas [CONDUCTA]
  El gestor respeta los protocolos y políticas de cobranza vigentes.
  CUMPLE por defecto. NO_CUMPLE SOLO ante incumplimiento evidente: ofrece condiciones no autorizadas,
  divulga información confidencial de terceros, viola la privacidad del deudor.

herr_explica_ofrecidas [ACCIÓN]
  El gestor explica claramente las herramientas disponibles (planes, descuentos, modos de pago).
  CUMPLE: "Tiene la opción de pago en 3 cuotas, o un descuento del 15% si paga en efectivo hoy"
  NO_CUMPLE: Solo menciona que hay opciones sin explicarlas, o directamente no las menciona.

herr_ofrece_pex [ACCIÓN]
  El gestor ofrece la herramienta PEX cuando corresponde al perfil del deudor.
  NO_APLICA: si el perfil claramente no aplica (deuda judicial, monto incompatible con PEX).
  CUMPLE: Menciona u ofrece explícitamente PEX al cliente.
  NO_CUMPLE: Corresponde ofrecerlo según el perfil pero no lo menciona.

━━━ DOCUMENTACIÓN ━━━

doc_codifica [ACCIÓN]
  El gestor menciona o confirma que registra el resultado en el sistema.
  NO_APLICA (por defecto): salvo que el gestor lo mencione explícitamente en la llamada.
  CUMPLE: "Lo dejo codificado en el sistema" / "Registro el acuerdo en la plataforma ahora"
  NO_CUMPLE: El gestor dice explícitamente que NO va a registrar o que no puede hacerlo.

doc_gestiones_ant [ACCIÓN]
  El gestor consulta y tiene en cuenta el historial de gestiones anteriores del cliente.
  CUMPLE: "Veo que la última gestión fue el 5 de marzo..." / "Según el historial, ya acordaron..."
  NO_CUMPLE: Actúa completamente sin referencias al historial cuando este debería consultarse.

doc_act_demograficos [ACCIÓN]
  El gestor actualiza o verifica datos demográficos del cliente (teléfono, dirección, email).
  NO_APLICA: si no hay necesidad ni oportunidad de actualizar datos en esta llamada.
  CUMPLE: "¿Sigue viviendo en la misma dirección?" / "¿Cambió de número de teléfono?"
  NO_CUMPLE: Había oportunidad clara de verificar/actualizar datos y no lo hizo.

━━━ COMPLIANCE — BASICS (peso 35%) ━━━

bas_identificacion [ACCIÓN]
  El gestor verifica la identidad del interlocutor antes de brindar información sensible.
  CUMPLE: "¿Estoy hablando con [nombre]?" / "¿Puede confirmarme su número de DNI?"
  NO_CUMPLE: Brinda montos, datos de la deuda u otra información sensible sin verificar quién es.

bas_informacion [ACCIÓN]
  La información brindada sobre la deuda es correcta, completa y verificable.
  CUMPLE: Monto correcto, nombre correcto, deuda identificada y explicada con claridad.
  NO_CUMPLE: Da montos incorrectos, nombre equivocado, o información contradictoria en la misma llamada.

bas_respeto [CONDUCTA]
  El gestor mantiene trato respetuoso durante toda la llamada, sin presión indebida.
  CUMPLE por defecto. NO_CUMPLE SOLO ante: insultos directos, amenazas explícitas, gritos, acoso,
  sarcasmo ofensivo, o coerción explícita ("lo voy a denunciar", "le voy a bloquear todo").
  NO es violación: tono firme, urgencia, insistencia respetuosa, trato informal, frustración moderada.
  Ante la menor duda: CUMPLE.

bas_veracidad [CONDUCTA]
  El gestor no brinda información falsa ni hace promesas que no puede cumplir.
  CUMPLE por defecto. NO_CUMPLE SOLO ante mentira o dato incorrecto verificable en la transcripción.
  Ej NO_CUMPLE: dice que el monto es $X y luego en la misma llamada dice que es $Y diferente.

════════════════════════════════════════════════
FORMATO DE RESPUESTA
════════════════════════════════════════════════

Respondé ÚNICAMENTE con JSON válido. Sin texto antes ni después del JSON.

{
  "pre_analysis": {
    "call_type": "TITULAR|TERCERO|NO_CONTACTO",
    "call_outcome": "descripción breve del resultado de la llamada",
    "sufficient_content": true,
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
        sufficient_content: Boolean(parsedPreAnalysis.sufficient_content),
        notes: parsedPreAnalysis.notes ? String(parsedPreAnalysis.notes) : undefined,
      }
    : undefined;

  logger.info(
    { call_type: preAnalysis?.call_type, sufficient_content: preAnalysis?.sufficient_content },
    'scoring pre-analysis',
  );

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
    justifications,
    modelOutput: parsed,
  };

  return { scores, pre_analysis: preAnalysis, raw: normalizedRaw };
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
