import prisma from '../lib/prisma';
import { analyzeDebtor } from '../services/debtor-analysis.service';

async function main() {
  const evaluations = await prisma.evaluation.findMany({
    where: {
      deletedAt: null,
      transcript: { not: null },
    },
    select: {
      id: true,
      call_id: true,
      debtor_analysis: { select: { id: true, monto_adeudado: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Evaluaciones con transcripción: ${evaluations.length}`);

  let done = 0;
  let skipped = 0;
  let errors = 0;

  for (const ev of evaluations) {
    const hasAmount = ev.debtor_analysis?.monto_adeudado != null;
    if (hasAmount && !process.argv.includes('--force')) {
      console.log(`  ↷ ${ev.call_id} — ya tiene monto_adeudado, salteando`);
      skipped++;
      continue;
    }

    const full = await prisma.evaluation.findUnique({
      where: { id: ev.id },
      select: { transcript: true },
    });

    if (!full?.transcript) continue;

    try {
      console.log(`  ⟳ ${ev.call_id} — analizando...`);
      const { analysis, raw } = await analyzeDebtor(full.transcript);

      if (ev.debtor_analysis) {
        await prisma.debtorAnalysis.update({
          where: { evaluationId: ev.id },
          data: { ...analysis, ai_raw_response: raw as object },
        });
      } else {
        await prisma.debtorAnalysis.create({
          data: { evaluationId: ev.id, ...analysis, ai_raw_response: raw as object },
        });
      }

      console.log(
        `  ✓ ${ev.call_id} — monto_adeudado: ${analysis.monto_adeudado ?? 'null'}, conflicto: ${analysis.nivel_conflicto}`,
      );
      done++;
    } catch (err) {
      console.error(`  ✗ ${ev.call_id} — error:`, err);
      errors++;
    }
  }

  console.log(`\nListo: ${done} actualizadas, ${skipped} salteadas, ${errors} errores`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
