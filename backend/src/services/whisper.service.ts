import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../lib/logger';

const execFileAsync = promisify(execFile);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 120_000,
});

export interface TranscribeResult {
  transcript: string;
  transcript_json: object;
  duration_s: number | undefined;
}

interface WhisperVerboseJson {
  text: string;
  duration?: number;
  segments?: unknown[];
  words?: unknown[];
}

/**
 * Convert any audio file to a clean 16 kHz mono PCM WAV with normalized volume.
 * Whisper hallucinates (loops a single phrase forever) when fed odd codecs,
 * very low volume, or unusual sample rates — common in call-center recordings.
 * A normalized WAV eliminates almost all of those loops.
 */
async function preprocessToWav(inputPath: string): Promise<{ path: string; cleanup: boolean }> {
  const wavPath = path.join(os.tmpdir(), `whisper-${crypto.randomUUID()}.wav`);
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-ar', '16000', // 16 kHz — Whisper's native rate
      '-ac', '1', // mono
      '-af', 'loudnorm', // normalize loudness so quiet audio is still heard
      '-c:a', 'pcm_s16le',
      '-y',
      wavPath,
    ]);
    return { path: wavPath, cleanup: true };
  } catch (err) {
    logger.warn({ err, inputPath }, 'ffmpeg preprocess failed — using original file');
    return { path: inputPath, cleanup: false };
  }
}

/**
 * Detect a Whisper hallucination loop: the same short phrase repeated many
 * times (e.g. "¿Quién es ese hombre?" x100). Real dialogue has variety.
 */
function isHallucinatedTranscript(text: string): boolean {
  if (!text || text.trim().length < 60) return false;
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (sentences.length < 8) return false;
  const unique = new Set(sentences);
  // 8+ sentences but ≤3 distinct → almost certainly a decoding loop
  return unique.size <= 3;
}

async function runWhisper(wavPath: string, temperature: number): Promise<WhisperVerboseJson> {
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(wavPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    language: 'es',
    temperature,
    // Keep SHORT and free of full sentences — Whisper repeats prompt text
    // verbatim on low-energy audio. A brief vocabulary hint is safe.
    prompt: 'Llamada de cobranza en español rioplatense.',
  });
  return response as unknown as WhisperVerboseJson;
}

const CHUNK_SECONDS = 120;

/**
 * Split a WAV into fixed-length chunks. Whisper hallucination loops poison
 * everything *after* the bad segment; chunking confines the damage so one
 * bad chunk never ruins the whole call. Returns chunk paths in order.
 */
async function splitIntoChunks(wavPath: string, outDir: string): Promise<string[]> {
  await execFileAsync('ffmpeg', [
    '-i', wavPath,
    '-f', 'segment',
    '-segment_time', String(CHUNK_SECONDS),
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    '-y',
    path.join(outDir, 'chunk_%03d.wav'),
  ]);
  return fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith('chunk_') && f.endsWith('.wav'))
    .sort()
    .map((f) => path.join(outDir, f));
}

/** Transcribe one chunk, retrying at higher temperature if it loops. */
async function transcribeChunk(chunkPath: string): Promise<WhisperVerboseJson> {
  let result = await runWhisper(chunkPath, 0);
  for (const temp of [0.4, 0.7]) {
    if (!isHallucinatedTranscript(result.text)) break;
    logger.warn({ chunkPath, temp }, 'whisper chunk hallucinated — retrying hotter');
    result = await runWhisper(chunkPath, temp);
  }
  return result;
}

export async function transcribeAudio(filePath: string): Promise<TranscribeResult> {
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error(`Archivo no encontrado: ${filePath}`), { status: 400 });
  }

  const { path: wavPath, cleanup } = await preprocessToWav(filePath);
  const chunkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-chunks-'));

  try {
    const chunkPaths = await splitIntoChunks(wavPath, chunkDir);
    logger.info({ filePath, chunks: chunkPaths.length }, 'transcribing audio in chunks');

    const parts: string[] = [];
    let totalDuration = 0;

    for (const chunkPath of chunkPaths) {
      const result = await transcribeChunk(chunkPath);
      // If a chunk still loops after retries, drop its garbage rather than
      // letting it pollute the transcript — the rest of the call stays valid.
      if (result.text?.trim() && !isHallucinatedTranscript(result.text)) {
        parts.push(result.text.trim());
      } else if (result.text?.trim()) {
        logger.warn({ chunkPath }, 'chunk hallucinated after retries — discarding its text');
      }
      if (typeof result.duration === 'number') totalDuration += result.duration;
    }

    const fullText = parts.join(' ');
    const dialogueTranscript = await formatAsDialogue(fullText).then(verifyDialogue);

    return {
      transcript: dialogueTranscript,
      transcript_json: { text: fullText, chunks: chunkPaths.length },
      duration_s: totalDuration > 0 ? Math.round(totalDuration) : undefined,
    };
  } finally {
    if (cleanup) fs.promises.unlink(wavPath).catch(() => {});
    fs.promises.rm(chunkDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function reformatTranscriptDialogue(rawText: string): Promise<string> {
  const labeled = await formatAsDialogue(rawText);
  return verifyDialogue(labeled);
}

async function formatAsDialogue(rawTranscript: string): Promise<string> {
  if (!rawTranscript?.trim()) return rawTranscript;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Sos un experto en análisis de llamadas de cobranza telefónica saliente (outbound).
Tu tarea es tomar una transcripción cruda (sin etiquetas de hablante) y agregarle las etiquetas GESTOR y DEUDOR.

════════════════════════════════════════════
CONTEXTO DE LA LLAMADA — LEÉ ESTO PRIMERO
════════════════════════════════════════════
En esta llamada hay exactamente DOS personas:

  PERSONA A — EL GESTOR:
  Es un empleado de "Recuperos y Mandatos", una agencia de cobros.
  Su trabajo es recuperar deudas. Llama desde la empresa para cobrar una deuda.
  Tiene acceso al SISTEMA de la empresa acreedora (ej: American Express): ve el historial de pagos, las fechas de acreditación, los saldos, los últimos movimientos.
  Conoce todos los canales de pago, los montos, los planes, los descuentos disponibles.
  Explica cómo hacer el pago, qué datos ingresar, cómo usar la plataforma.
  Explica cómo funciona la acreditación de pagos (feriados, tiempos del banco).

  PERSONA B — EL DEUDOR:
  Es la persona que recibe la llamada porque tiene una deuda pendiente.
  No tiene acceso al sistema de la empresa — solo sabe lo que él mismo hizo.
  Puede dar excusas, negociar, prometer pagar, o desconocer la deuda.
  NUNCA sabe cómo funciona el sistema de cobro — eso lo explica el GESTOR.

════════════════════════════════════════════
REGLA FUNDAMENTAL — NUNCA IGNORAR
════════════════════════════════════════════
Esta es una llamada SALIENTE: el GESTOR llama al DEUDOR.
EL GESTOR SIEMPRE HABLA PRIMERO. La primera línea de diálogo es siempre del GESTOR.

════════════════════════════════════════════
CONSISTENCIA DE ROLES — CRÍTICO
════════════════════════════════════════════
Los roles NO se intercambian durante la llamada. Una vez que identificaste qué voz es el GESTOR, esa voz es GESTOR en toda la transcripción. Lo mismo para el DEUDOR.
- Si un fragmento es ambiguo, NO cambies el rol del turno anterior a menos que haya una señal clara de cambio de hablante.
- Si dos fragmentos consecutivos parecen del mismo rol, unilos en un solo turno en lugar de dividirlos y reasignarlos.
- Si hay ruido o fragmentos inaudibles, marcalos como [inaudible].

════════════════════════════════════════════
REGLAS DE ATRIBUCIÓN — EN ORDEN DE PRIORIDAD
════════════════════════════════════════════
1. INSTRUCCIONES DE PAGO → siempre GESTOR.
   Si alguien explica cómo pagar (pasos, plataformas, número de cuenta, número de tarjeta,
   número de referencia, dígitos, Rapipago, Pago Fácil, American Express, transferencia, etc.)
   → esa persona ES EL GESTOR. El DEUDOR nunca le enseña al GESTOR cómo cobrar.

2. DATOS DEL SISTEMA → siempre GESTOR.
   Quien menciona fechas de último pago acreditado, saldos exactos, historial de movimientos,
   cómo funciona la acreditación (feriados, tiempos del banco), o dice "la información que tengo
   es la que muestra el sistema" → ES EL GESTOR. Solo él tiene acceso al sistema de la empresa.

3. INFORMACIÓN DE LA DEUDA → siempre GESTOR.
   Quien menciona montos exactos, fechas de vencimiento, nombre del acreedor, planes de pago,
   frases como "le llamo por su cuenta", "tenemos registrada una deuda", "le podemos ofrecer un plan"
   → es el GESTOR, porque él tiene esa información.

4. EXCUSAS / PROMESAS / DATOS PROPIOS DEL DEUDOR → siempre DEUDOR.
   "No tengo trabajo", "No tengo dinero", "¿Cuánto debo?", "Te pago el viernes",
   "Yo pagué ayer", "no soy yo", "llamá en otro momento" → DEUDOR.

5. APERTURA DE LLAMADA → siempre GESTOR.
   Saludo inicial + presentación ("Hola, buenos días, habla [nombre] de Recuperos y Mandatos") → GESTOR.

════════════════════════════════════════════
FORMATO DE SALIDA
════════════════════════════════════════════
- Una intervención por línea: "GESTOR: [texto]" o "DEUDOR: [texto]"
- Si una intervención es larga, mantenerla en una sola línea
- No inventés ni omitás ningún contenido del original
- Conservá las palabras exactas del original
- Devolvé ÚNICAMENTE el diálogo etiquetado, sin encabezados ni comentarios`,
        },
        {
          role: 'user',
          content: `Transcripción cruda de llamada de cobranza:\n\n${rawTranscript}`,
        },
      ],
    });

    const formatted = completion.choices[0].message.content?.trim();
    if (!formatted) return rawTranscript;

    const hasDialogueLines = /^(GESTOR|DEUDOR):/m.test(formatted);
    if (!hasDialogueLines) return rawTranscript;

    // Validate: GESTOR must have lines
    const hasGestorLines = /^GESTOR:/m.test(formatted);
    if (!hasGestorLines) return rawTranscript;

    // Detect swapped speakers and auto-correct
    if (isSpeakersSwapped(formatted)) {
      logger.warn('formatAsDialogue: detected swapped speakers, auto-correcting');
      return swapSpeakerLabels(formatted);
    }

    return formatted;
  } catch (err) {
    logger.warn({ err }, 'formatAsDialogue: failed, returning raw transcript');
    return rawTranscript;
  }
}

async function verifyDialogue(labeled: string): Promise<string> {
  if (!labeled?.trim()) return labeled;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Sos un revisor de diálogos de llamadas de cobranza. Recibís un diálogo ya etiquetado con GESTOR y DEUDOR y debés corregir cualquier error de atribución.

════════════════════════════════════════════
QUIÉNES SON
════════════════════════════════════════════
GESTOR: empleado de "Recuperos y Mandatos". Llamó primero. Habla en nombre de la empresa acreedora (ej: American Express). Tiene acceso al SISTEMA de la empresa: ve el historial de pagos, los montos, las fechas de acreditación, los últimos movimientos.
DEUDOR: persona que recibió la llamada. Tiene deuda. Solo sabe lo que él mismo hizo; no tiene acceso al sistema de la empresa.

════════════════════════════════════════════
CONSISTENCIA DE ROLES — CRÍTICO
════════════════════════════════════════════
Los roles NO se intercambian durante la llamada. Una vez que una voz fue identificada como GESTOR, es GESTOR en toda la transcripción.
- Si un fragmento es ambiguo, mantené el rol del turno anterior.
- Si dos turnos consecutivos del mismo rol parecen ser continuación del mismo hablante, unilos en uno solo.
- Fragmentos inaudibles: [inaudible].

════════════════════════════════════════════
PRINCIPIO CLAVE — QUIÉN TIENE LA INFORMACIÓN
════════════════════════════════════════════
El GESTOR tiene el sistema. El DEUDOR tiene su propia experiencia.

→ "La información que yo le doy es la información que tiene [empresa]" → GESTOR
→ "El último pago que tengo acreditado es el [fecha]" → GESTOR (lo ve en el sistema)
→ "¿Se hizo un pago en los últimos días?" → GESTOR (pregunta para verificar en sistema)
→ Explicar cómo funciona la acreditación de pagos, los feriados, los tiempos del banco → GESTOR
→ Mencionar saldos exactos, montos de deuda, números de tarjeta de la empresa → GESTOR
→ "Si usted pagó, todavía no está acreditado / es imposible saberlo" → GESTOR

════════════════════════════════════════════
LEÉ TODA LA CONVERSACIÓN ANTES DE CORREGIR
════════════════════════════════════════════
Los errores suelen aparecer en bloques donde el GESTOR explica algo largo y el modelo parte el bloque incorrectamente. Si una línea es continuación lógica de lo que dijo el GESTOR antes, probablemente también sea del GESTOR.

════════════════════════════════════════════
OTRAS SEÑALES INEQUÍVOCAS
════════════════════════════════════════════
→ "Señor/Señora [apellido]" dirigiéndose al deudor → GESTOR
→ "Muchas gracias", "Muy amable", "Bárbaro" en respuesta a un ofrecimiento → DEUDOR
→ "Quedamos a disposición", "Esperamos su pago", cierre de la llamada → GESTOR
→ Quien dicta su propio número de teléfono → DEUDOR
→ Quien repite/confirma el número que le dictan → GESTOR
→ Instrucciones de pago, pasos de la plataforma → GESTOR
→ Excusas, promesas de pago → DEUDOR

════════════════════════════════════════════
INSTRUCCIONES
════════════════════════════════════════════
- Si el diálogo está correcto, devolvélo SIN NINGÚN CAMBIO.
- Si hay errores, corregí SOLO las etiquetas. El texto no se toca.
- Devolvé ÚNICAMENTE el diálogo, sin explicaciones ni comentarios.`,
        },
        {
          role: 'user',
          content: `Revisá este diálogo y corregí los errores de atribución si los hay:\n\n${labeled}`,
        },
      ],
    });

    const verified = completion.choices[0].message.content?.trim();
    if (!verified) return labeled;

    const hasDialogueLines = /^(GESTOR|DEUDOR):/m.test(verified);
    if (!hasDialogueLines) return labeled;

    if (isSpeakersSwapped(verified)) {
      logger.warn('verifyDialogue: post-verify swap detected, auto-correcting');
      return swapSpeakerLabels(verified);
    }

    return verified;
  } catch (err) {
    logger.warn({ err }, 'verifyDialogue: failed, returning labeled transcript as-is');
    return labeled;
  }
}

// Heuristic: if the first dialogue line is DEUDOR, or if DEUDOR lines contain
// typical GESTOR language (debt/company mentions) and GESTOR lines contain excuses,
// the speakers are likely swapped.
function isSpeakersSwapped(formatted: string): boolean {
  const lines = formatted.split('\n').map((l) => l.trim()).filter(Boolean);

  const firstLine = lines.find((l) => /^(GESTOR|DEUDOR):/i.test(l));
  if (firstLine && /^DEUDOR:/i.test(firstLine)) return true;

  const gestorText = lines
    .filter((l) => /^GESTOR:/i.test(l))
    .map((l) => l.replace(/^GESTOR:\s*/i, ''))
    .join(' ')
    .toLowerCase();

  const deudorText = lines
    .filter((l) => /^DEUDOR:/i.test(l))
    .map((l) => l.replace(/^DEUDOR:\s*/i, ''))
    .join(' ')
    .toLowerCase();

  const collectionKeywords = /recuperos|mandatos|deuda|debe|vencimiento|cuota|monto|pagar|cobr|regulariz|acreedor/;
  const excuseKeywords = /no tengo|no puedo|sin trabajo|sin dinero|enferm|no sé|no me alcanza/;

  // If DEUDOR sounds like the collector and GESTOR sounds like the debtor → swapped
  const deudorSoundsLikeCollector = collectionKeywords.test(deudorText) && !collectionKeywords.test(gestorText);
  const gestorSoundsLikeDebtor = excuseKeywords.test(gestorText) && !excuseKeywords.test(deudorText);

  return deudorSoundsLikeCollector && gestorSoundsLikeDebtor;
}

function swapSpeakerLabels(formatted: string): string {
  return formatted
    .replace(/^GESTOR:/gm, '__SWAP__:')
    .replace(/^DEUDOR:/gm, 'GESTOR:')
    .replace(/^__SWAP__:/gm, 'DEUDOR:');
}

