import { Fragment } from 'react';
import { Evaluation, ScoreValue } from '../services/api.service';
import ScoreBadge from './ScoreBadge';

interface Props {
  evaluation: Evaluation;
}

interface ScoringSection {
  title: string;
  weight?: string;
  items: { label: string; field: keyof Evaluation }[];
}

const sections: ScoringSection[] = [
  {
    title: 'Escucha Activa',
    items: [
      { label: 'Preguntó motivo de atraso', field: 'ea_preg_motivo_atraso' },
      { label: 'Sondeó capacidad de pago', field: 'ea_sondea_capacidad_pago' },
      { label: 'Utilizó información del deudor', field: 'ea_utiliza_informacion' },
    ],
  },
  {
    title: 'Resolución',
    items: [
      { label: 'Negoció con sentido de urgencia', field: 'res_neg_sentido_urgencia' },
      { label: 'Negoció totalidad de la deuda', field: 'res_negociacion_total_rr' },
      { label: 'Ofreció herramienta de pago', field: 'res_ofrece_herramienta' },
    ],
  },
  {
    title: 'Prevención',
    items: [
      { label: 'Explicó consecuencias y beneficios', field: 'prev_consecuencias_beneficios' },
    ],
  },
  {
    title: 'Estructura / CORE',
    weight: '50%',
    items: [
      { label: 'Apertura correcta', field: 'core_apertura' },
      { label: 'Control de la llamada', field: 'core_control' },
      { label: 'Cierre efectivo', field: 'core_cierre' },
    ],
  },
  {
    title: 'Herramientas',
    items: [
      { label: 'Siguió políticas', field: 'herr_sigue_politicas' },
      { label: 'Explicó herramientas ofrecidas', field: 'herr_explica_ofrecidas' },
      { label: 'Ofreció PEX', field: 'herr_ofrece_pex' },
    ],
  },
  {
    title: 'Documentación',
    items: [
      { label: 'Codificó correctamente', field: 'doc_codifica' },
      { label: 'Revisó gestiones anteriores', field: 'doc_gestiones_ant' },
      { label: 'Actualizó datos demográficos', field: 'doc_act_demograficos' },
    ],
  },
  {
    title: 'Compliance / BASICS',
    weight: '35%',
    items: [
      { label: 'Identificación correcta', field: 'bas_identificacion' },
      { label: 'Información precisa', field: 'bas_informacion' },
      { label: 'Trato con respeto', field: 'bas_respeto' },
      { label: 'Veracidad en la información', field: 'bas_veracidad' },
    ],
  },
];

export default function ScoringTable({ evaluation }: Props) {
  const justifications = extractJustifications(evaluation.ai_scoring_raw);

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.title} className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
            <h4 className="font-semibold text-sm text-brand-dark">{section.title}</h4>
            {section.weight && (
              <span className="text-xs font-bold text-brand-red bg-red-50 px-2 py-0.5 rounded">
                Peso: {section.weight}
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {section.items.map(({ label, field }) => (
                <Fragment key={String(field)}>
                  <tr className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-700">{label}</td>
                    <td className="px-4 py-2 text-right">
                      <ScoreBadge value={evaluation[field] as ScoreValue} />
                    </td>
                  </tr>
                  {justifications[field] && (
                    <tr className="border-b border-gray-100 last:border-0">
                      <td colSpan={2} className="px-4 pb-3 pt-0">
                        <details className="group">
                          <summary className="cursor-pointer text-xs text-brand-red hover:underline">
                            Ver justificación
                          </summary>
                          <JustificationText text={justifications[field] ?? ''} />
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function extractJustifications(raw: Evaluation['ai_scoring_raw']): Partial<Record<keyof Evaluation, string>> {
  if (!raw || typeof raw !== 'object') return {};

  const container = raw as { justifications?: unknown };
  const source = container.justifications;
  if (!source || typeof source !== 'object') return {};

  const out: Partial<Record<keyof Evaluation, string>> = {};
  Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      out[key as keyof Evaluation] = value.trim();
    }
  });

  return out;
}

function JustificationText({ text }: { text: string }) {
  const citationMatch = text.match(/Cita:\s*['\"]?([^'\"]+)['\"]?/i);
  const matchedCitation = citationMatch?.[0];
  const citation = citationMatch?.[1]?.trim();
  const body = matchedCitation ? text.replace(matchedCitation, '').trim() : text;

  return (
    <div className="mt-1 text-xs leading-relaxed">
      <p className="text-gray-600">{body || text}</p>
      {citation && (
        <p className="mt-1 inline-block rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 border border-gray-200">
          Cita: {citation}
        </p>
      )}
    </div>
  );
}
