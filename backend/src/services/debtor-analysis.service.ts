import OpenAI from 'openai';

export type DebtJustification =
  | 'NO_CONOCIA_DEUDA' | 'SIN_DINERO' | 'DISPUTA_MONTO' | 'DESEMPLEO'
  | 'PROBLEMA_SALUD' | 'OLVIDO' | 'ACUERDO_PREVIO' | 'NIEGA_DEUDA'
  | 'PROMESA_PAGO' | 'OTRA';

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

const DEBTOR_PROMPT = `Eres un analista experto en cobranza para "Recuperos y Mandatos".
Analiza la transcripción de la llamada de cobranza y extrae información sobre el comportamiento y situación del deudor.

Regla crítica de identidad:
- Si el deudor corrige o deletrea su nombre/apellido, usa esa versión corregida como válida.
- No inventes ni normalices apellidos si hay una corrección explícita en el diálogo.

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
  'NO_CONOCIA_DEUDA', 'SIN_DINERO', 'DISPUTA_MONTO', 'DESEMPLEO',
  'PROBLEMA_SALUD', 'OLVIDO', 'ACUERDO_PREVIO', 'NIEGA_DEUDA', 'PROMESA_PAGO', 'OTRA',
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
    parsed = {};
  }
  const deudorNombreRaw = typeof parsed.deudor_nombre === 'string' ? parsed.deudor_nombre.trim() : '';
  const motivoNoPago = typeof parsed.motivo_no_pago_resumen === 'string'
    ? parsed.motivo_no_pago_resumen.trim()
    : '';

  const analysis: DebtorAnalysisData = {
    justificacion_tipo: VALID_JUSTIFICATIONS.includes(parsed.justificacion_tipo as DebtJustification)
      ? (parsed.justificacion_tipo as DebtJustification)
      : 'OTRA',
    justificacion_detalle: typeof parsed.justificacion_detalle === 'string'
      ? parsed.justificacion_detalle
      : 'No especificado',
    promesa_de_pago: parsed.promesa_de_pago === true,
    fecha_promesa: parsed.fecha_promesa && typeof parsed.fecha_promesa === 'string'
      ? new Date(parsed.fecha_promesa)
      : null,
    monto_prometido: typeof parsed.monto_prometido === 'number' ? parsed.monto_prometido : null,
    nivel_conflicto: VALID_CONFLICT_LEVELS.includes(parsed.nivel_conflicto as ConflictLevel)
      ? (parsed.nivel_conflicto as ConflictLevel)
      : 'MEDIO',
    resumen_situacion: typeof parsed.resumen_situacion === 'string'
      ? parsed.resumen_situacion
      : 'Sin información',
  };

  const enrichedRaw: DebtorAiRaw & Record<string, unknown> = {
    ...parsed,
    deudor_nombre: deudorNombreRaw || null,
    motivo_no_pago_resumen: motivoNoPago || analysis.justificacion_detalle,
  };

  return { analysis, raw: enrichedRaw };
}
