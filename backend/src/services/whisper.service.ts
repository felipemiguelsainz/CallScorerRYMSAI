import OpenAI from 'openai';
import fs from 'fs';

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

export async function transcribeAudio(filePath: string): Promise<TranscribeResult> {
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error(`Archivo no encontrado: ${filePath}`), { status: 400 });
  }

  const fileStream = fs.createReadStream(filePath);

  const response = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1',
    response_format: 'verbose_json',
    language: 'es',
  });

  const verboseJson = response as unknown as {
    text: string;
    duration?: number;
    segments?: unknown[];
    words?: unknown[];
  };

  const dialogueTranscript = await formatAsDialogue(verboseJson.text);

  return {
    transcript: dialogueTranscript,
    transcript_json: verboseJson,
    duration_s: verboseJson.duration ? Math.round(verboseJson.duration) : undefined,
  };
}

async function formatAsDialogue(rawTranscript: string): Promise<string> {
  if (!rawTranscript?.trim()) return rawTranscript;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Convierte transcripciones de cobranza en formato diálogo. Reglas: 1) usa SOLO etiquetas GESTOR y DEUDOR. 2) una intervención por línea: "GESTOR: ..." o "DEUDOR: ...". 3) no inventes contenido; si dudas de hablante, asigna por contexto de cobranza. 4) conserva el idioma original. 5) devuelve SOLO texto plano, sin markdown ni explicación.',
        },
        {
          role: 'user',
          content: `Transcripción cruda:\n\n${rawTranscript}`,
        },
      ],
    });

    const formatted = completion.choices[0].message.content?.trim();
    if (!formatted) return rawTranscript;

    const hasDialogueLines = /^(GESTOR|DEUDOR):/m.test(formatted);
    return hasDialogueLines ? formatted : rawTranscript;
  } catch {
    return rawTranscript;
  }
}
