import OpenAI from 'openai';

export type DebtJustification =
  | 'NO_CONOCIA_DEUDA'
  | 'SIN_DINERO'
  | 'DISPUTA_MONTO'
  | 'DESEMPLEO'
  | 'PROBLEMA_SALUD'
  | 'OLVIDO'
  | 'ACUERDO_PREVIO'
  | 'NIEGA_DEUDA'
  | 'PROMESA_PAGO'
  | 'OTRA';

export type ConflictLevel = 'BAJO' | 'MEDIO' | 'ALTO';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 120_000,
});

export interface DebtorAnalysisData {
  justificacion_tipo: DebtJustification;
  justificacion_detalle: string;
  promesa_de_pago: boolean;
  fecha_promesa: Date | null;
  monto_prometido: number | null;
  nivel_conflicto: ConflictLevel;
  resumen_situacion: string;
}

interface DebtorAiRaw {
  deudor_nombre: string | null;
  motivo_no_pago_resumen: string;
}

export interface DebtorAnalysisResult {
  analysis: DebtorAnalysisData;
  raw: object;
}

interface TranscriptFallback {
  debtorName: string | null;
  reasonSummary: string | null;
  inferredJustification: DebtJustification | null;
}

function cleanExtractedName(name: string): string | null {
  const normalized = name
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  const words = normalized.split(' ');
  if (words.length > 6) return null;
  return normalized;
}

function inferJustificationByKeywords(text: string): DebtJustification | null {
  const value = text.toLowerCase();
  if (/no conozco|no reconozco|no es m[ií]a|no es mi deuda/.test(value)) {
    return 'NO_CONOCIA_DEUDA';
  }
  if (/sin trabajo|desemplead|me qued[eé] sin trabajo/.test(value)) {
    return 'DESEMPLEO';
  }
  if (/no tengo dinero|sin dinero|no me alcanza|no llego|no puedo pagar/.test(value)) {
    return 'SIN_DINERO';
  }
  if (/enfermedad|salud|internad|operaci[oó]n|medic/.test(value)) {
    return 'PROBLEMA_SALUD';
  }
  if (/no me acord|me olvid|olvido/.test(value)) {
    return 'OLVIDO';
  }
  if (/ya pagu[eé]|ya hice un pago|acuerdo previo|ya arregl[eé]/.test(value)) {
    return 'ACUERDO_PREVIO';
  }
  if (/no debo|nunca deb[ií]|rechazo la deuda|no corresponde/.test(value)) {
    return 'NIEGA_DEUDA';
  }
  if (/prometo pagar|voy a pagar|pago el|te pago/.test(value)) {
    return 'PROMESA_PAGO';
  }
  if (/monto|inter[eé]s|no coincide|me cobran de m[aá]s/.test(value)) {
    return 'DISPUTA_MONTO';
  }
  return null;
}

export function extractDebtorContextFromTranscript(transcript: string): TranscriptFallback {
  const debtorLines = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^DEUDOR\s*:/i.test(line))
    .map((line) => line.replace(/^DEUDOR\s*:\s*/i, '').trim())
    .filter(Boolean);

  const debtorJoined = debtorLines.join(' ');

  let debtorName: string | null = null;
  const namePatterns = [
    /(?:mi nombre es|me llamo|habla)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+){0,3})/i,
    /soy\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ'\-]+){0,3})/i,
  ];

  for (const pattern of namePatterns) {
    const match = debtorJoined.match(pattern);
    if (match?.[1]) {
      debtorName = cleanExtractedName(match[1]);
      if (debtorName) break;
    }
  }

  const reasonLine = debtorLines.find((line) => inferJustificationByKeywords(line));
  const inferredJustification = reasonLine ? inferJustificationByKeywords(reasonLine) : null;

  return {
    debtorName,
    reasonSummary: reasonLine ?? null,
    inferredJustification,
  };
}

function applyTranscriptFallback(
  result: DebtorAnalysisResult,
  transcript: string,
): DebtorAnalysisResult {
  const fallback = extractDebtorContextFromTranscript(transcript);
  const raw = result.raw as Record<string, unknown>;
  const currentName = typeof raw.deudor_nombre === 'string' ? raw.deudor_nombre.trim() : '';
  const currentReason =
    typeof raw.motivo_no_pago_resumen === 'string' ? raw.motivo_no_pago_resumen.trim() : '';

  const mergedRaw: Record<string, unknown> = {
    ...raw,
    deudor_nombre: currentName || fallback.debtorName || null,
    motivo_no_pago_resumen: currentReason || fallback.reasonSummary || result.analysis.justificacion_detalle,
  };

  return {
    analysis: {
      ...result.analysis,
      justificacion_tipo:
        result.analysis.justificacion_tipo === 'OTRA' && fallback.inferredJustification
          ? fallback.inferredJustification
          : result.analysis.justificacion_tipo,
      justificacion_detalle:
        result.analysis.justificacion_detalle === 'No especificado' && fallback.reasonSummary
          ? fallback.reasonSummary
          : result.analysis.justificacion_detalle,
    },
    raw: mergedRaw,
  };
}

// Converts any AI JSON into a stable internal shape with strict defaults.
export function normalizeDebtorAnalysisPayload(
  parsed: Record<string, unknown>,
): DebtorAnalysisResult {
  const deudorNombreRaw =
    typeof parsed.deudor_nombre === 'string' ? parsed.deudor_nombre.trim() : '';
  const motivoNoPago =
    typeof parsed.motivo_no_pago_resumen === 'string' ? parsed.motivo_no_pago_resumen.trim() : '';

  const analysis: DebtorAnalysisData = {
    // Enumerations are explicitly whitelisted to prevent invalid DB writes.
    justificacion_tipo: VALID_JUSTIFICATIONS.includes(
      parsed.justificacion_tipo as DebtJustification,
    )
      ? (parsed.justificacion_tipo as DebtJustification)
      : 'OTRA',
    justificacion_detalle:
      typeof parsed.justificacion_detalle === 'string'
        ? parsed.justificacion_detalle
        : 'No especificado',
    promesa_de_pago: parsed.promesa_de_pago === true,
    fecha_promesa:
      parsed.fecha_promesa && typeof parsed.fecha_promesa === 'string'
        ? new Date(parsed.fecha_promesa)
        : null,
    monto_prometido: typeof parsed.monto_prometido === 'number' ? parsed.monto_prometido : null,
    nivel_conflicto: VALID_CONFLICT_LEVELS.includes(parsed.nivel_conflicto as ConflictLevel)
      ? (parsed.nivel_conflicto as ConflictLevel)
      : 'MEDIO',
    resumen_situacion:
      typeof parsed.resumen_situacion === 'string' ? parsed.resumen_situacion : 'Sin información',
  };

  const enrichedRaw: DebtorAiRaw & Record<string, unknown> = {
    ...parsed,
    deudor_nombre: deudorNombreRaw || null,
    motivo_no_pago_resumen: motivoNoPago || analysis.justificacion_detalle,
  };

  return { analysis, raw: enrichedRaw };
}

const DEBTOR_PROMPT = `Eres un analista experto en cobranza para "Recuperos y Mandatos".
Analiza la transcripción de la llamada de cobranza y extrae información sobre el comportamiento y situación del deudor.

Regla crítica de identidad:
- Si el deudor corrige o deletrea su nombre/apellido, usa esa versión corregida como válida.
- No inventes ni normalices apellidos si hay una corrección explícita en el diálogo.
- Prioriza SIEMPRE las líneas etiquetadas como "DEUDOR:" para identidad y motivo de no pago.
- Si hay conflicto entre lo dicho por GESTOR y DEUDOR, prevalece DEUDOR.

Debes devolver un JSON con exactamente estas claves:

{
  "justificacion_tipo": uno de: NO_CONOCIA_DEUDA | SIN_DINERO | DISPUTA_MONTO | DESEMPLEO | PROBLEMA_SALUD | OLVIDO | ACUERDO_PREVIO | NIEGA_DEUDA | PROMESA_PAGO | OTRA,
  "justificacion_detalle": "texto literal o paráfrasis de lo que dijo el deudor para justificar",
  "promesa_de_pago": true o false,
  "fecha_promesa": "YYYY-MM-DD" o null si no hay promesa,
  "monto_prometido": número o null si no se mencionó monto,
  "nivel_conflicto": BAJO | MEDIO | ALTO (según el tono y actitud del deudor),
  "resumen_situacion": "resumen en 2-3 oraciones de la situación del deudor",
  "deudor_nombre": "nombre completo del deudor mencionado en la llamada, o null si no se identifica",
  "motivo_no_pago_resumen": "1 oración con el principal motivo de no pago, citando brevemente lo dicho por el deudor"
}

Responde ÚNICAMENTE con el JSON válido, sin texto adicional.`;

const VALID_JUSTIFICATIONS: DebtJustification[] = [
  'NO_CONOCIA_DEUDA',
  'SIN_DINERO',
  'DISPUTA_MONTO',
  'DESEMPLEO',
  'PROBLEMA_SALUD',
  'OLVIDO',
  'ACUERDO_PREVIO',
  'NIEGA_DEUDA',
  'PROMESA_PAGO',
  'OTRA',
];

const VALID_CONFLICT_LEVELS: ConflictLevel[] = ['BAJO', 'MEDIO', 'ALTO'];

export async function analyzeDebtor(transcript: string): Promise<DebtorAnalysisResult> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: DEBTOR_PROMPT },
      { role: 'user', content: `TRANSCRIPCIÓN:\n\n${transcript}` },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content ?? '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // If model output is malformed, we still return deterministic defaults.
    parsed = {};
  }

  const normalized = normalizeDebtorAnalysisPayload(parsed);
  return applyTranscriptFallback(normalized, transcript);
}
