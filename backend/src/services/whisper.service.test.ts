import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

async function getTranscribeAudio() {
  const mod = await import('./whisper.service');
  return mod.transcribeAudio;
}

test('transcribeAudio fails with 400 when file does not exist', async () => {
  const nonExistentPath = 'C:/tmp/does-not-exist-audio-file.mp3';
  const transcribeAudio = await getTranscribeAudio();

  await assert.rejects(
    () => transcribeAudio(nonExistentPath),
    (err: unknown) => {
      const error = err as Error & { status?: number };
      assert.equal(error.status, 400);
      assert.match(error.message, /Archivo no encontrado/);
      return true;
    },
  );
});
