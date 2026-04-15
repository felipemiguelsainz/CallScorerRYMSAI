import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

async function getNormalizeDebtorAnalysisPayload() {
  const mod = await import('./debtor-analysis.service');
  return mod.normalizeDebtorAnalysisPayload;
}

async function getExtractDebtorContextFromTranscript() {
  const mod = await import('./debtor-analysis.service');
  return mod.extractDebtorContextFromTranscript;
}

test('normalizeDebtorAnalysisPayload applies safe defaults on malformed payload', () => {
  return getNormalizeDebtorAnalysisPayload().then((normalizeDebtorAnalysisPayload) => {
    const result = normalizeDebtorAnalysisPayload({
      justificacion_tipo: 'INVALID',
      justificacion_detalle: 123,
      promesa_de_pago: 'true',
      fecha_promesa: 123,
      monto_prometido: '1000',
      nivel_conflicto: 'INVALID',
      resumen_situacion: null,
    });

    assert.equal(result.analysis.justificacion_tipo, 'OTRA');
    assert.equal(result.analysis.justificacion_detalle, 'No especificado');
    assert.equal(result.analysis.promesa_de_pago, false);
    assert.equal(result.analysis.fecha_promesa, null);
    assert.equal(result.analysis.monto_prometido, null);
    assert.equal(result.analysis.nivel_conflicto, 'MEDIO');
    assert.equal(result.analysis.resumen_situacion, 'Sin información');
  });
});

test('normalizeDebtorAnalysisPayload normalizes debtor identity and fallback reason', () => {
  return getNormalizeDebtorAnalysisPayload().then((normalizeDebtorAnalysisPayload) => {
    const result = normalizeDebtorAnalysisPayload({
      justificacion_tipo: 'SIN_DINERO',
      justificacion_detalle: 'No tengo ingreso fijo',
      promesa_de_pago: true,
      fecha_promesa: '2026-03-20',
      monto_prometido: 15000,
      nivel_conflicto: 'BAJO',
      resumen_situacion: 'Se comprometió a pagar.',
      deudor_nombre: '  Juan Perez  ',
      motivo_no_pago_resumen: '   ',
    });

    assert.equal(result.analysis.justificacion_tipo, 'SIN_DINERO');
    assert.equal(result.analysis.promesa_de_pago, true);
    assert.equal(result.analysis.fecha_promesa?.toISOString().startsWith('2026-03-20'), true);
    assert.equal(result.analysis.monto_prometido, 15000);
    assert.equal(result.analysis.nivel_conflicto, 'BAJO');

    const raw = result.raw as { deudor_nombre: string | null; motivo_no_pago_resumen: string };
    assert.equal(raw.deudor_nombre, 'Juan Perez');
    assert.equal(raw.motivo_no_pago_resumen, 'No tengo ingreso fijo');
  });
});

test('extractDebtorContextFromTranscript gets debtor name and reason from DEUDOR lines', () => {
  return getExtractDebtorContextFromTranscript().then((extractDebtorContextFromTranscript) => {
    const transcript = [
      'GESTOR: Buen día, ¿con quién hablo?',
      'DEUDOR: Mi nombre es Juan Perez.',
      'GESTOR: ¿Por qué no pudo pagar?',
      'DEUDOR: No tengo dinero este mes porque me quedé sin trabajo.',
    ].join('\n');

    const extracted = extractDebtorContextFromTranscript(transcript);

    assert.equal(extracted.debtorName, 'Juan Perez');
    assert.match(extracted.reasonSummary ?? '', /No tengo dinero/i);
    assert.equal(extracted.inferredJustification, 'DESEMPLEO');
  });
});
