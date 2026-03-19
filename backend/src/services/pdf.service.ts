import PDFDocument from 'pdfkit';
import type { Evaluation, Gestor, User, DebtorAnalysis } from '.prisma/client';

type EvaluationWithRelations = Evaluation & {
  gestor: Gestor;
  auditor: Pick<User, 'id' | 'name' | 'email'>;
  debtor_analysis: DebtorAnalysis | null;
};

const BRAND_RED = '#CC0000';
const BRAND_DARK = '#333333';
const GREEN = '#16a34a';
const ORANGE = '#ea580c';

function scoreColor(score: number): string {
  if (score >= 80) return GREEN;
  if (score >= 60) return ORANGE;
  return BRAND_RED;
}

function scoreLabel(val: string): string {
  if (val === 'CUMPLE') return '✓';
  if (val === 'NO_CUMPLE') return '✗';
  return '—';
}

export async function generateEvaluationPDF(eval_: EvaluationWithRelations): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ─────────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(BRAND_RED);
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
      .text('recuperos ✓ mandatos', 50, 25);
    doc.fontSize(10).font('Helvetica')
      .text('Evaluación de Llamada de Cobranza', 50, 52);

    doc.moveDown(3);

    // ── Call Info ──────────────────────────────────────────────────────────────
    doc.fillColor(BRAND_DARK).fontSize(14).font('Helvetica-Bold').text('Datos de la Llamada');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND_RED);
    doc.moveDown(0.5);

    const info = [
      ['Call ID', eval_.call_id],
      ['N° de Cuenta', eval_.account_number],
      ['N° de Asignación', eval_.assignment_number],
      ['Tipo de Contacto', eval_.contact_type],
      ['Gestor', eval_.gestor.name + (eval_.gestor.legajo ? ` (Leg: ${eval_.gestor.legajo})` : '')],
      ['Auditor', eval_.auditor.name],
      ['Fecha de Captura', new Date(eval_.capture_date).toLocaleDateString('es-AR')],
      ['Estado', eval_.status],
    ];

    doc.fontSize(10).font('Helvetica');
    for (const [label, value] of info) {
      doc.fillColor(BRAND_DARK).text(`${label}: `, { continued: true }).font('Helvetica-Bold').text(String(value ?? ''));
      doc.font('Helvetica');
    }

    doc.moveDown();

    // ── Score Summary ──────────────────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').fillColor(BRAND_DARK).text('Puntaje Final');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND_RED);
    doc.moveDown(0.5);

    const totalScore = Number(eval_.score_total);
    doc.fontSize(32).font('Helvetica-Bold').fillColor(scoreColor(totalScore))
      .text(`${totalScore.toFixed(1)}%`, { align: 'center' });

    doc.fontSize(11).font('Helvetica').fillColor(BRAND_DARK);
    doc.text(`CORE (50%): ${Number(eval_.score_core).toFixed(1)}%   |   BASICS (35%): ${Number(eval_.score_basics).toFixed(1)}%`, { align: 'center' });

    doc.moveDown();

    // ── Scoring Detail ─────────────────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').fillColor(BRAND_DARK).text('Rúbrica de Evaluación');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND_RED);
    doc.moveDown(0.5);

    const sections = [
      {
        title: 'ESCUCHA ACTIVA', items: [
          ['Preguntó motivo de atraso', eval_.ea_preg_motivo_atraso],
          ['Sondeó capacidad de pago', eval_.ea_sondea_capacidad_pago],
          ['Utilizó información', eval_.ea_utiliza_informacion],
        ],
      },
      {
        title: 'RESOLUCIÓN', items: [
          ['Negoció con urgencia', eval_.res_neg_sentido_urgencia],
          ['Negoció total RR', eval_.res_negociacion_total_rr],
          ['Ofreció herramienta', eval_.res_ofrece_herramienta],
        ],
      },
      {
        title: 'PREVENCIÓN', items: [
          ['Consecuencias y beneficios', eval_.prev_consecuencias_beneficios],
        ],
      },
      {
        title: 'ESTRUCTURA / CORE (50%)', items: [
          ['Apertura', eval_.core_apertura],
          ['Control', eval_.core_control],
          ['Cierre', eval_.core_cierre],
        ],
      },
      {
        title: 'HERRAMIENTAS', items: [
          ['Sigue políticas', eval_.herr_sigue_politicas],
          ['Explica ofrecidas', eval_.herr_explica_ofrecidas],
          ['Ofrece PEX', eval_.herr_ofrece_pex],
        ],
      },
      {
        title: 'DOCUMENTACIÓN', items: [
          ['Codifica', eval_.doc_codifica],
          ['Gestiones anteriores', eval_.doc_gestiones_ant],
          ['Actualiza demográficos', eval_.doc_act_demograficos],
        ],
      },
      {
        title: 'COMPLIANCE / BASICS (35%)', items: [
          ['Identificación', eval_.bas_identificacion],
          ['Información', eval_.bas_informacion],
          ['Respeto', eval_.bas_respeto],
          ['Veracidad', eval_.bas_veracidad],
        ],
      },
    ];

    for (const section of sections) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND_DARK).text(section.title);
      for (const [label, val] of section.items) {
        const color = val === 'CUMPLE' ? GREEN : val === 'NO_CUMPLE' ? BRAND_RED : '#888888';
        doc.fontSize(10).font('Helvetica').fillColor(BRAND_DARK)
          .text(`  ${label}: `, { continued: true })
          .fillColor(color).font('Helvetica-Bold').text(scoreLabel(String(val)));
        doc.font('Helvetica').fillColor(BRAND_DARK);
      }
      doc.moveDown(0.3);
    }

    // ── Debtor Analysis ────────────────────────────────────────────────────────
    if (eval_.debtor_analysis) {
      doc.addPage();
      const da = eval_.debtor_analysis;
      doc.rect(0, 0, doc.page.width, 80).fill(BRAND_RED);
      doc.fillColor('white').fontSize(16).font('Helvetica-Bold')
        .text('Análisis del Deudor', 50, 30);

      doc.moveDown(3);
      doc.fillColor(BRAND_DARK).fontSize(12);

      const daInfo = [
        ['Tipo de Justificación', da.justificacion_tipo],
        ['Promesa de Pago', da.promesa_de_pago ? 'Sí' : 'No'],
        ['Fecha Promesa', da.fecha_promesa ? new Date(da.fecha_promesa).toLocaleDateString('es-AR') : '—'],
        ['Monto Prometido', da.monto_prometido ? `$${da.monto_prometido.toLocaleString('es-AR')}` : '—'],
        ['Nivel de Conflicto', da.nivel_conflicto],
      ];

      for (const [label, value] of daInfo) {
        doc.font('Helvetica').text(`${label}: `, { continued: true })
          .font('Helvetica-Bold').text(String(value ?? ''));
      }

      doc.moveDown();
      doc.fontSize(11).font('Helvetica-Bold').text('Justificación del Deudor:');
      doc.font('Helvetica').text(da.justificacion_detalle);

      doc.moveDown();
      doc.fontSize(11).font('Helvetica-Bold').text('Resumen de la Situación:');
      doc.font('Helvetica').text(da.resumen_situacion);
    }

    // ── Observaciones ──────────────────────────────────────────────────────────
    if (eval_.observaciones) {
      doc.moveDown();
      doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND_DARK).text('Observaciones:');
      doc.font('Helvetica').text(eval_.observaciones);
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#888888')
      .text(`Generado: ${new Date().toLocaleString('es-AR')} | Recuperos y Mandatos`,
        50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
