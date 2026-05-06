import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-chars-long!!';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

type ScoringFields = {
  ea_preg_motivo_atraso: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  ea_sondea_capacidad_pago: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  ea_utiliza_informacion: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  res_neg_sentido_urgencia: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  res_negociacion_total_rr: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  res_ofrece_herramienta: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  prev_consecuencias_beneficios: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  core_apertura: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  core_control: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  core_cierre: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  herr_sigue_politicas: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  herr_explica_ofrecidas: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  herr_ofrece_pex: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  doc_codifica: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  doc_gestiones_ant: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  doc_act_demograficos: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  bas_identificacion: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  bas_informacion: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  bas_respeto: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
  bas_veracidad: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA';
};

async function getCalculateScores() {
  const mod = await import('./scoring.service');
  return mod.calculateScores;
}

function allWith(value: 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA'): ScoringFields {
  return {
    ea_preg_motivo_atraso: value,
    ea_sondea_capacidad_pago: value,
    ea_utiliza_informacion: value,
    res_neg_sentido_urgencia: value,
    res_negociacion_total_rr: value,
    res_ofrece_herramienta: value,
    prev_consecuencias_beneficios: value,
    core_apertura: value,
    core_control: value,
    core_cierre: value,
    herr_sigue_politicas: value,
    herr_explica_ofrecidas: value,
    herr_ofrece_pex: value,
    doc_codifica: value,
    doc_gestiones_ant: value,
    doc_act_demograficos: value,
    bas_identificacion: value,
    bas_informacion: value,
    bas_respeto: value,
    bas_veracidad: value,
  };
}

test('calculateScores returns 100 when all criteria are CUMPLE', () => {
  return getCalculateScores().then((calculateScores) => {
    const result = calculateScores(allWith('CUMPLE'));
    assert.equal(result.score_total, 100);
    assert.equal(result.score_core, 100);
    assert.equal(result.score_basics, 100);
    assert.equal(result.total_applicable, 20);
    assert.equal(result.is_scoreable, true);
  });
});

test('calculateScores returns 0 when all criteria are NO_CUMPLE', () => {
  return getCalculateScores().then((calculateScores) => {
    const result = calculateScores(allWith('NO_CUMPLE'));
    assert.equal(result.score_total, 0);
    assert.equal(result.score_core, 0);
    assert.equal(result.score_basics, 0);
    assert.equal(result.total_applicable, 20);
    assert.equal(result.is_scoreable, true);
  });
});

test('calculateScores normalizes weights when CORE has no applicable criteria', () => {
  return getCalculateScores().then((calculateScores) => {
    const dataset = allWith('CUMPLE');
    dataset.core_apertura = 'NO_APLICA';
    dataset.core_control = 'NO_APLICA';
    dataset.core_cierre = 'NO_APLICA';

    const result = calculateScores(dataset);
    assert.equal(result.breakdown.normalized_weights.core, 0);
    assert.equal(result.score_total, 100);
    assert.equal(result.total_applicable, 17);
    assert.equal(result.is_scoreable, true);
  });
});

test('calculateScores returns total_applicable = 0 and is_scoreable = false when all NO_APLICA', () => {
  return getCalculateScores().then((calculateScores) => {
    const result = calculateScores(allWith('NO_APLICA'));
    assert.equal(result.total_applicable, 0);
    assert.equal(result.is_scoreable, false);
    assert.equal(result.score_total, 0);
    assert.equal(result.score_core, 0);
    assert.equal(result.score_basics, 0);
  });
});

test('calculateScores is_scoreable = false when fewer than 5 criteria applicable', () => {
  return getCalculateScores().then((calculateScores) => {
    // Only 4 applicable criteria: core_apertura(CUMPLE), core_control(NO_CUMPLE), bas_identificacion(CUMPLE), bas_respeto(CUMPLE)
    const dataset = allWith('NO_APLICA');
    dataset.core_apertura = 'CUMPLE';
    dataset.core_control = 'NO_CUMPLE';
    dataset.bas_identificacion = 'CUMPLE';
    dataset.bas_respeto = 'CUMPLE';

    const result = calculateScores(dataset);
    assert.equal(result.total_applicable, 4);
    assert.equal(result.is_scoreable, false);
  });
});

test('calculateScores weighted score with mixed CORE/BASICS and no OTHER', () => {
  // CORE: 3 CUMPLE → score 100, weight 0.5
  // BASICS: 2 CUMPLE / 2 NO_CUMPLE → score 50, weight 0.35
  // OTHER: all NO_APLICA → excluded
  // Normalized weights: core = 0.5/0.85, basics = 0.35/0.85
  // Expected total = 100 * (0.5/0.85) + 50 * (0.35/0.85) = 58.82 + 20.59 = 79.41
  return getCalculateScores().then((calculateScores) => {
    const dataset = allWith('NO_APLICA');
    dataset.core_apertura = 'CUMPLE';
    dataset.core_control = 'CUMPLE';
    dataset.core_cierre = 'CUMPLE';
    dataset.bas_identificacion = 'CUMPLE';
    dataset.bas_informacion = 'CUMPLE';
    dataset.bas_respeto = 'NO_CUMPLE';
    dataset.bas_veracidad = 'NO_CUMPLE';

    const result = calculateScores(dataset);
    assert.equal(result.score_core, 100);
    assert.equal(result.score_basics, 50);
    assert.equal(result.score_total, 79.41);
    assert.equal(result.total_applicable, 7);
    assert.equal(result.is_scoreable, true);
  });
});

test('calculateScores with all buckets partially scored computes correct weighted total', () => {
  // CORE: 2 CUMPLE / 1 NO_CUMPLE → score 66.67
  // BASICS: 4 CUMPLE → score 100
  // OTHER: 6 CUMPLE / 7 NO_APLICA → score 100 (6 applicable out of 13, all CUMPLE)
  // Actually: 6 CUMPLE + 0 NO_CUMPLE = 6 applicable
  // Wait, I need to pick specific OTHER fields. Let's do 3 CUMPLE + 0 NO_CUMPLE out of 13 OTHER (rest NO_APLICA)
  // OTHER applicable = 3, score = 100
  // Normalized: core 0.5 + basics 0.35 + other 0.15 = 1.0 (all applicable, no redistribution)
  // Total = 66.67 * 0.5 + 100 * 0.35 + 100 * 0.15 = 33.33 + 35 + 15 = 83.33
  return getCalculateScores().then((calculateScores) => {
    const dataset = allWith('NO_APLICA');
    dataset.core_apertura = 'CUMPLE';
    dataset.core_control = 'CUMPLE';
    dataset.core_cierre = 'NO_CUMPLE';
    dataset.bas_identificacion = 'CUMPLE';
    dataset.bas_informacion = 'CUMPLE';
    dataset.bas_respeto = 'CUMPLE';
    dataset.bas_veracidad = 'CUMPLE';
    dataset.ea_preg_motivo_atraso = 'CUMPLE';
    dataset.ea_sondea_capacidad_pago = 'CUMPLE';
    dataset.ea_utiliza_informacion = 'CUMPLE';

    const result = calculateScores(dataset);
    assert.equal(result.score_core, 66.67);
    assert.equal(result.score_basics, 100);
    assert.equal(result.total_applicable, 10);
    assert.equal(result.is_scoreable, true);
    // other score = 100, all 3 buckets applicable → no weight redistribution
    assert.equal(result.score_total, 83.33);
  });
});
