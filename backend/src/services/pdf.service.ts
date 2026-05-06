import path from 'path';
import PDFDocument from 'pdfkit';
import type { Evaluation, Gestor, User, DebtorAnalysis } from '.prisma/client';

type EvaluationWithRelations = Evaluation & {
  gestor: Gestor;
  auditor: Pick<User, 'id' | 'name' | 'email'>;
  debtor_analysis: DebtorAnalysis | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const PW = 595.28;
const PH = 841.89;
const ML = 48;        // margin left
const MR = 48;        // margin right
const CW = PW - ML - MR; // content width = 499.28
const LOGO = path.join(__dirname, '../assets/logotipo.png');

const RED     = '#C8102E';
const DARK    = '#111827';
const GRAY    = '#6B7280';
const LGRAY   = '#F9FAFB';
const BORDER  = '#E5E7EB';
const WHITE   = '#FFFFFF';
const GREEN   = '#166534';
const LGREEN  = '#DCFCE7';
const ORANGE  = '#9A3412';
const LORANGE = '#FFEDD5';
const BLUE    = '#1E40AF';
const LBLUE   = '#DBEAFE';
const AMBER   = '#92400E';
const LAMBER  = '#FEF3C7';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreTheme(n: number) {
  if (n >= 80) return { fg: GREEN,  bg: LGREEN  };
  if (n >= 60) return { fg: ORANGE, bg: LORANGE };
  return             { fg: RED,     bg: '#FEE2E2' };
}

function conflictTheme(level: string) {
  if (level === 'BAJO')  return { fg: GREEN,  bg: LGREEN,  label: 'BAJO'  };
  if (level === 'MEDIO') return { fg: AMBER,  bg: LAMBER,  label: 'MEDIO' };
  return                        { fg: RED,    bg: '#FEE2E2', label: 'ALTO' };
}

function criterionTheme(val: string | null) {
  if (val === 'CUMPLE')    return { fg: GREEN,  bg: LGREEN,  label: 'CUMPLE'     };
  if (val === 'NO_CUMPLE') return { fg: RED,    bg: '#FEE2E2', label: 'NO CUMPLE' };
  return                          { fg: GRAY,   bg: LGRAY,   label: 'N / A'      };
}

// Draw a pill that does NOT move doc.y
function pill(
  doc: PDFKit.PDFDocument,
  x: number, y: number,
  label: string, fg: string, bg: string,
  w = 74,
) {
  doc.save();
  doc.roundedRect(x, y, w, 14, 3).fill(bg);
  doc.fontSize(7).font('Helvetica-Bold').fillColor(fg)
    .text(label, x, y + 3.5, { width: w, align: 'center', lineBreak: false });
  doc.restore();
}

// Footer written once per page
function footer(doc: PDFKit.PDFDocument) {
  doc.save();
  doc.moveTo(ML, PH - 28).lineTo(PW - MR, PH - 28)
    .strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.fontSize(7).font('Helvetica').fillColor(GRAY)
    .text(
      `Generado el ${new Date().toLocaleString('es-AR')} · Recuperos y Mandatos · Documento confidencial`,
      ML, PH - 20, { width: CW, align: 'center', lineBreak: false },
    );
  doc.restore();
}

// Ensure at least `need` vertical space remains; add page if not
function need(doc: PDFKit.PDFDocument, space: number) {
  if (doc.y + space > PH - 44) {
    doc.addPage();
    footer(doc);
    doc.y = ML;
  }
}

// Bold label + regular value on same row, 2-column
function row(doc: PDFKit.PDFDocument, label: string, value: string, valueBold = false) {
  need(doc, 16);
  const y = doc.y;
  doc.save();
  doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
    .text(label, ML, y, { width: 155, lineBreak: false });
  doc.fontSize(8.5).font(valueBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK)
    .text(value, ML + 160, y, { width: CW - 160 });
  doc.restore();
  if (doc.y < y + 14) doc.y = y + 14;
}

// Labeled text block with tinted background
function textBox(doc: PDFKit.PDFDocument, label: string, body: string, bgColor: string) {
  need(doc, 36);
  doc.save();
  doc.fontSize(8).font('Helvetica-Bold').fillColor(GRAY)
    .text(label.toUpperCase(), ML, doc.y);
  doc.moveDown(0.15);
  const bh = doc.heightOfString(body, { width: CW - 16 }) + 14;
  need(doc, bh);
  const by = doc.y;
  doc.roundedRect(ML, by, CW, bh, 4).fill(bgColor);
  doc.fontSize(8.5).font('Helvetica').fillColor(DARK)
    .text(body, ML + 10, by + 7, { width: CW - 16 });
  doc.restore();
  doc.y = by + bh + 8;
}

// Section header bar
function section(doc: PDFKit.PDFDocument, title: string) {
  need(doc, 28);
  const y = doc.y + 4;
  doc.save();
  doc.rect(ML, y, CW, 22).fill(LGRAY);
  doc.rect(ML, y, 3, 22).fill(RED);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
    .text(title, ML + 12, y + 7, { width: CW - 60, lineBreak: false });
  doc.restore();
  doc.y = y + 26;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateEvaluationPDF(ev: EvaluationWithRelations): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4', autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    footer(doc);

    // ── HEADER ───────────────────────────────────────────────────────────────
    // White area at top
    const HDR_H = 72;
    doc.rect(0, 0, PW, HDR_H).fill(WHITE);

    // Logo (left-aligned, centered vertically in header)
    try {
      doc.image(LOGO, ML, 16, { height: 38 });
    } catch {
      doc.fontSize(16).font('Helvetica-Bold').fillColor(GRAY)
        .text('recuperos ✓ mandatos', ML, 24, { lineBreak: false });
    }

    // Title block (right side)
    doc.save();
    doc.fontSize(13).font('Helvetica-Bold').fillColor(DARK)
      .text('INFORME DE EVALUACIÓN', 0, 18, { width: PW - MR - 8, align: 'right', lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
      .text('Llamada de Cobranza', 0, 36, { width: PW - MR - 8, align: 'right', lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
      .text(
        new Date(ev.capture_date).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }),
        0, 50, { width: PW - MR - 8, align: 'right', lineBreak: false },
      );
    doc.restore();

    // Red bottom border on header
    doc.rect(0, HDR_H - 3, PW, 3).fill(RED);

    doc.y = HDR_H + 16;

    // ── SCORE BOX ────────────────────────────────────────────────────────────
    const total = Number(ev.score_total);
    const core  = Number(ev.score_core);
    const basics = Number(ev.score_basics);
    const st = scoreTheme(total);

    const BOX_H = 72;
    const BOX_Y = doc.y;
    const COL   = CW / 3;

    // Outer box
    doc.roundedRect(ML, BOX_Y, CW, BOX_H, 5).fill(st.bg);

    // Dividers
    [1, 2].forEach(i => {
      doc.save();
      doc.moveTo(ML + COL * i, BOX_Y + 12).lineTo(ML + COL * i, BOX_Y + BOX_H - 12)
        .strokeColor(st.fg).lineWidth(0.5).opacity(0.4).stroke();
      doc.restore();
    });

    // Total
    doc.save();
    doc.fontSize(28).font('Helvetica-Bold').fillColor(st.fg)
      .text(`${total.toFixed(1)}%`, ML, BOX_Y + 10, { width: COL, align: 'center', lineBreak: false });
    doc.fontSize(7).font('Helvetica-Bold').fillColor(st.fg)
      .text('PUNTAJE TOTAL', ML, BOX_Y + 48, { width: COL, align: 'center', lineBreak: false });
    doc.restore();

    // Core
    const cs = scoreTheme(core);
    doc.save();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(cs.fg)
      .text(`${core.toFixed(1)}%`, ML + COL, BOX_Y + 16, { width: COL, align: 'center', lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(GRAY)
      .text('CORE · 50%', ML + COL, BOX_Y + 44, { width: COL, align: 'center', lineBreak: false });
    doc.restore();

    // Basics
    const bs = scoreTheme(basics);
    doc.save();
    doc.fontSize(20).font('Helvetica-Bold').fillColor(bs.fg)
      .text(`${basics.toFixed(1)}%`, ML + COL * 2, BOX_Y + 16, { width: COL, align: 'center', lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(GRAY)
      .text('BASICS · 35%', ML + COL * 2, BOX_Y + 44, { width: COL, align: 'center', lineBreak: false });
    doc.restore();

    doc.y = BOX_Y + BOX_H + 18;

    // ── DATOS DE LA LLAMADA ───────────────────────────────────────────────────
    const contactMap: Record<string, string> = {
      TITULAR: 'Titular', TERCERO: 'Tercero', NO_CONTACTO: 'Sin contacto',
    };

    section(doc, 'Datos de la Llamada');
    row(doc, 'Call ID',              ev.call_id);
    row(doc, 'Número de cuenta',     ev.account_number);
    row(doc, 'Número de asignación', ev.assignment_number);
    row(doc, 'Tipo de contacto',     contactMap[ev.contact_type ?? ''] ?? ev.contact_type ?? '—');
    row(doc, 'Gestor evaluado',      ev.gestor.name + (ev.gestor.legajo ? ` · Leg. ${ev.gestor.legajo}` : ''), true);
    row(doc, 'Auditor',              ev.auditor.name);
    row(doc, 'Fecha de captura',     new Date(ev.capture_date).toLocaleDateString('es-AR'));
    row(doc, 'Estado',               ev.status === 'COMPLETED' ? 'Completada' : ev.status);

    doc.moveDown(0.6);

    // ── ANÁLISIS DEL DEUDOR ───────────────────────────────────────────────────
    if (ev.debtor_analysis) {
      const da = ev.debtor_analysis;
      const debtorName = (da.ai_raw_response as Record<string, unknown>)?.deudor_nombre as string | null;

      section(doc, 'Análisis del Deudor');

      if (debtorName) row(doc, 'Nombre del deudor', debtorName, true);

      if (da.monto_adeudado != null) {
        row(doc, 'Monto adeudado',
          `$${da.monto_adeudado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, true);
      }

      // Conflict row with pill
      need(doc, 16);
      const crow = doc.y;
      doc.save();
      doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
        .text('Nivel de conflicto', ML, crow, { width: 155, lineBreak: false });
      doc.restore();
      const ct = conflictTheme(da.nivel_conflicto);
      pill(doc, ML + 160, crow, ct.label, ct.fg, ct.bg, 56);
      doc.y = crow + 16;

      const justMap: Record<string, string> = {
        NO_CONOCIA_DEUDA: 'No conocía la deuda', SIN_DINERO: 'Sin dinero',
        DISPUTA_MONTO: 'Disputa el monto', DESEMPLEO: 'Desempleo',
        PROBLEMA_SALUD: 'Problema de salud', OLVIDO: 'Olvido',
        ACUERDO_PREVIO: 'Acuerdo previo', NIEGA_DEUDA: 'Niega la deuda',
        PROMESA_PAGO: 'Promesa de pago', OTRA: 'Otra',
      };
      row(doc, 'Tipo de justificación', justMap[da.justificacion_tipo] ?? da.justificacion_tipo);
      row(doc, 'Promesa de pago', da.promesa_de_pago ? 'Sí' : 'No');
      if (da.fecha_promesa) {
        row(doc, 'Fecha prometida', new Date(da.fecha_promesa).toLocaleDateString('es-AR'));
      }
      if (da.monto_prometido != null) {
        row(doc, 'Monto prometido',
          `$${da.monto_prometido.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
      }

      doc.moveDown(0.4);
      textBox(doc, 'Justificación expresada', da.justificacion_detalle, LGRAY);
      textBox(doc, 'Resumen de situación',    da.resumen_situacion,     LGRAY);
      doc.moveDown(0.4);
    }

    // ── RÚBRICA ───────────────────────────────────────────────────────────────
    section(doc, 'Rúbrica de Evaluación');

    const rubric: { group: string; accent: string; items: [string, string | null][] }[] = [
      {
        group: 'CORE (50%) — Estructura',
        accent: RED,
        items: [
          ['Apertura',  ev.core_apertura],
          ['Control',   ev.core_control],
          ['Cierre',    ev.core_cierre],
        ],
      },
      {
        group: 'BASICS (35%) — Compliance',
        accent: BLUE,
        items: [
          ['Identificación', ev.bas_identificacion],
          ['Información',    ev.bas_informacion],
          ['Respeto',        ev.bas_respeto],
          ['Veracidad',      ev.bas_veracidad],
        ],
      },
      {
        group: 'Escucha Activa',
        accent: GRAY,
        items: [
          ['Preguntó motivo de atraso',       ev.ea_preg_motivo_atraso],
          ['Sondeó capacidad de pago',        ev.ea_sondea_capacidad_pago],
          ['Utilizó información del deudor',  ev.ea_utiliza_informacion],
        ],
      },
      {
        group: 'Resolución / Negociación',
        accent: GRAY,
        items: [
          ['Negoció con sentido de urgencia', ev.res_neg_sentido_urgencia],
          ['Negoció recupero total',          ev.res_negociacion_total_rr],
          ['Ofreció herramienta de pago',     ev.res_ofrece_herramienta],
        ],
      },
      {
        group: 'Prevención',
        accent: GRAY,
        items: [['Consecuencias y beneficios', ev.prev_consecuencias_beneficios]],
      },
      {
        group: 'Herramientas',
        accent: GRAY,
        items: [
          ['Sigue políticas',           ev.herr_sigue_politicas],
          ['Explica herramientas',      ev.herr_explica_ofrecidas],
          ['Ofrece PEX',                ev.herr_ofrece_pex],
        ],
      },
      {
        group: 'Documentación',
        accent: GRAY,
        items: [
          ['Codifica',                   ev.doc_codifica],
          ['Gestiones anteriores',       ev.doc_gestiones_ant],
          ['Actualiza datos demográficos', ev.doc_act_demograficos],
        ],
      },
    ];

    for (const { group, accent, items } of rubric) {
      need(doc, 18 + items.length * 18);

      // Group sub-header
      const gy = doc.y;
      doc.save();
      doc.rect(ML, gy, CW, 18).fill(accent === RED ? '#FEF2F2' : accent === BLUE ? '#EFF6FF' : LGRAY);
      doc.rect(ML, gy, 3, 18).fill(accent);
      doc.fontSize(8).font('Helvetica-Bold')
        .fillColor(accent === RED ? RED : accent === BLUE ? BLUE : DARK)
        .text(group, ML + 10, gy + 5, { width: CW - 90, lineBreak: false });
      doc.restore();
      doc.y = gy + 20;

      for (const [label, val] of items) {
        need(doc, 18);
        const ry = doc.y;
        const ct2 = criterionTheme(val as string | null);

        doc.save();
        doc.fontSize(8.5).font('Helvetica').fillColor(DARK)
          .text(label, ML + 10, ry + 3, { width: CW - 95, lineBreak: false });
        doc.restore();

        pill(doc, ML + CW - 74, ry + 1, ct2.label, ct2.fg, ct2.bg, 74);

        doc.save();
        doc.moveTo(ML, ry + 16).lineTo(ML + CW, ry + 16)
          .strokeColor(BORDER).lineWidth(0.3).stroke();
        doc.restore();

        doc.y = ry + 18;
      }

      doc.moveDown(0.5);
    }

    // ── OBSERVACIONES ─────────────────────────────────────────────────────────
    if (ev.observaciones) {
      doc.moveDown(0.3);
      textBox(doc, 'Observaciones', ev.observaciones, LAMBER);
    }

    doc.end();
  });
}
