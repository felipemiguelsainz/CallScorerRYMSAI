import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

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
  });
});

test('calculateScores returns 0 when all criteria are NO_CUMPLE', () => {
  return getCalculateScores().then((calculateScores) => {
    const result = calculateScores(allWith('NO_CUMPLE'));
    assert.equal(result.score_total, 0);
    assert.equal(result.score_core, 0);
    assert.equal(result.score_basics, 0);
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
  });
});
