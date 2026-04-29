import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { filterByUserScope } from '../middleware/scope.middleware';
import { requireRole } from '../middleware/role.middleware';
import { getCachedJson, setCachedJson } from '../lib/redis';

const router = Router();
router.use(authMiddleware);
router.use(filterByUserScope);

const DASHBOARD_CACHE_TTL_SECONDS = 300;

function toScopeKey(req: AuthRequest): string {
  const role = req.user?.role ?? 'ANON';
  const userId = req.user?.userId ?? 'anonymous';
  const gestorId = req.user?.gestorId ?? 'none';
  return `${role}:${userId}:${gestorId}`;
}

function buildPrevPeriodFilter(req: AuthRequest) {
  const { clienteId, gestorId, fechaDesde, fechaHasta } = req.query as Record<string, string>;
  // Default period: last 30 days. Prev period = 30 days before that.
  const now = new Date();
  let periodDays = 30;
  if (fechaDesde && fechaHasta) {
    periodDays = Math.ceil((new Date(fechaHasta).getTime() - new Date(fechaDesde).getTime()) / 86400000);
  }
  const prevEnd = fechaDesde ? new Date(fechaDesde) : new Date(now.getTime() - periodDays * 86400000);
  const prevStart = new Date(prevEnd.getTime() - periodDays * 86400000);

  return {
    deletedAt: null,
    ...(req.scopeFilter ?? {}),
    ...(clienteId ? { clienteId } : {}),
    ...(gestorId && req.user?.role !== 'GESTOR' ? { gestorId } : {}),
    capture_date: { gte: prevStart, lte: prevEnd },
  };
}

router.get('/kpis', async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:kpis:${toScopeKey(req)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const scopeFilter = { deletedAt: null, ...(req.scopeFilter ?? {}) };

  const [totalEvaluaciones, completadas, avgScores] = await Promise.all([
    prisma.evaluation.count({ where: scopeFilter }),
    prisma.evaluation.count({ where: { ...scopeFilter, status: 'COMPLETED' } }),
    prisma.evaluation.aggregate({
      where: scopeFilter,
      _avg: { score_total: true, score_core: true, score_basics: true },
      _max: { score_total: true },
      _min: { score_total: true },
    }),
  ]);

  if (req.user?.role === 'GESTOR') {
    const payload = {
      totalEvaluaciones,
      completadas,
      avgScoreTotal: Number(avgScores._avg.score_total ?? 0),
      avgScoreCore: Number(avgScores._avg.score_core ?? 0),
      avgScoreBasics: Number(avgScores._avg.score_basics ?? 0),
      bestScore: Number(avgScores._max.score_total ?? 0),
      worstScore: Number(avgScores._min.score_total ?? 0),
    };

    await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
    res.json(payload);
    return;
  }

  const topGestores = await prisma.evaluation.groupBy({
    by: ['gestorId'],
    where: scopeFilter,
    _avg: { score_total: true },
    _count: { id: true },
    orderBy: { _avg: { score_total: 'desc' } },
    take: 10,
  });

  const gestorIds = topGestores.map((g) => g.gestorId);
  const gestores = await prisma.gestor.findMany({
    where: { id: { in: gestorIds } },
    select: { id: true, name: true, legajo: true },
  });
  const gestorMap = Object.fromEntries(gestores.map((g) => [g.id, g]));

  const payload = {
    totalEvaluaciones,
    completadas,
    enDraft: totalEvaluaciones - completadas,
    avgScoreTotal: Number(avgScores._avg.score_total ?? 0),
    avgScoreCore: Number(avgScores._avg.score_core ?? 0),
    avgScoreBasics: Number(avgScores._avg.score_basics ?? 0),
    topGestores: topGestores.map((g) => ({
      gestor: gestorMap[g.gestorId],
      avgScore: Number(g._avg.score_total ?? 0),
      totalEvaluaciones: g._count.id,
    })),
  };

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
  res.json(payload);
});

router.get('/trends', async (req: AuthRequest, res: Response) => {
  const { days = '30' } = req.query as Record<string, string>;
  const cacheKey = `dashboard:trends:${toScopeKey(req)}:${days}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - parseInt(days, 10));

  const where = {
    deletedAt: null,
    status: 'COMPLETED' as const,
    capture_date: { gte: fromDate },
    ...(req.scopeFilter ?? {}),
  };

  const evaluaciones = await prisma.evaluation.findMany({
    where,
    select: { capture_date: true, score_total: true, score_core: true, score_basics: true },
    orderBy: { capture_date: 'asc' },
  });

  const byDay: Record<string, { total: number[]; core: number[]; basics: number[] }> = {};
  for (const ev of evaluaciones) {
    const day = ev.capture_date.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { total: [], core: [], basics: [] };
    byDay[day].total.push(Number(ev.score_total));
    byDay[day].core.push(Number(ev.score_core));
    byDay[day].basics.push(Number(ev.score_basics));
  }

  const trends = Object.entries(byDay).map(([date, scores]) => ({
    date,
    avgTotal: avg(scores.total),
    avgCore: avg(scores.core),
    avgBasics: avg(scores.basics),
    count: scores.total.length,
  }));

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, trends);
  res.json(trends);
});

router.get(
  '/ranking',
  requireRole('SUPERVISOR', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    const cacheKey = `dashboard:ranking:${toScopeKey(req)}`;
    const cached = await getCachedJson<unknown>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const ranking = await prisma.evaluation.groupBy({
      by: ['gestorId'],
      where: { deletedAt: null },
      _avg: { score_total: true },
      _count: { id: true },
      orderBy: { _avg: { score_total: 'desc' } },
    });

    const gestorIds = ranking.map((r) => r.gestorId);
    const gestores = await prisma.gestor.findMany({
      where: { id: { in: gestorIds } },
      select: { id: true, name: true, legajo: true },
    });
    const gestorMap = Object.fromEntries(gestores.map((g) => [g.id, g]));

    const payload = ranking.map((r) => ({
      gestor: gestorMap[r.gestorId],
      avgScore: Number(r._avg.score_total ?? 0),
      totalEvaluaciones: r._count.id,
    }));

    await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
    res.json(payload);
  },
);

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function buildDashboardFilter(req: AuthRequest) {
  const { clienteId, gestorId, fechaDesde, fechaHasta } = req.query as Record<string, string>;
  return {
    deletedAt: null,
    ...(req.scopeFilter ?? {}),
    ...(clienteId ? { clienteId } : {}),
    // GESTOR scope already pins gestorId; only apply if user is not GESTOR
    ...(gestorId && req.user?.role !== 'GESTOR' ? { gestorId } : {}),
    ...((fechaDesde || fechaHasta) ? {
      capture_date: {
        ...(fechaDesde ? { gte: new Date(fechaDesde) } : {}),
        ...(fechaHasta ? { lte: new Date(fechaHasta) } : {}),
      },
    } : {}),
  };
}

// ─── EXTENDED KPIs ────────────────────────────────────────────────────────────

router.get('/kpis-extended', async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:kpis-extended:${toScopeKey(req)}:${JSON.stringify(req.query)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const scopeFilter = buildDashboardFilter(req);
  const prevFilter = buildPrevPeriodFilter(req);

  const [evs, prevEvs, debtorStats] = await Promise.all([
    prisma.evaluation.findMany({
      where: { ...scopeFilter, status: 'COMPLETED' },
      select: { bas_informacion: true },
    }),
    prisma.evaluation.findMany({
      where: { ...prevFilter, status: 'COMPLETED' },
      select: { bas_informacion: true },
    }),
    prisma.debtorAnalysis.findMany({
      where: { evaluation: { ...scopeFilter, status: 'COMPLETED', deletedAt: null } },
      select: { promesa_de_pago: true, monto_prometido: true },
    }),
  ]);

  const calcSpeech = (list: { bas_informacion: string }[]) => {
    const applicable = list.filter((e) => e.bas_informacion !== 'NO_APLICA');
    if (applicable.length === 0) return 0;
    return Math.round((applicable.filter((e) => e.bas_informacion === 'CUMPLE').length / applicable.length) * 1000) / 10;
  };

  const speechActual = calcSpeech(evs);
  const speechPrev = calcSpeech(prevEvs);

  const promesas = debtorStats.filter((d) => d.promesa_de_pago).length;
  const promesasPct = debtorStats.length > 0 ? Math.round((promesas / debtorStats.length) * 1000) / 10 : 0;

  const montoRecuperado = debtorStats.reduce((acc, d) => acc + (d.monto_prometido ?? 0), 0);

  const payload = {
    cumplimientoSpeech: speechActual,
    cumplimientoSpeechDelta: Math.round((speechActual - speechPrev) * 10) / 10,
    promesasDePago: promesasPct,
    montoRecuperado,
  };

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
  res.json(payload);
});

// ─── SCORE POR CLIENTE ────────────────────────────────────────────────────────

router.get('/score-por-cliente', async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:score-por-cliente:${toScopeKey(req)}:${JSON.stringify(req.query)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const scopeFilter = buildDashboardFilter(req);

  const grouped = await prisma.evaluation.groupBy({
    by: ['clienteId'],
    where: { ...scopeFilter, clienteId: { not: null } },
    _avg: { score_total: true },
    _count: { id: true },
  });

  if (grouped.length === 0) { res.json([]); return; }

  const clienteIds = grouped.map((g) => g.clienteId!);
  const clientes = await prisma.cliente.findMany({
    where: { id: { in: clienteIds } },
    select: { id: true, nombre: true, icono: true },
  });
  const clienteMap = Object.fromEntries(clientes.map((c) => [c.id, c]));

  const payload = grouped.map((g) => ({
    clienteId: g.clienteId,
    nombre: clienteMap[g.clienteId!]?.nombre ?? 'Sin nombre',
    icono: clienteMap[g.clienteId!]?.icono ?? '🏢',
    avgScore: Number(g._avg.score_total ?? 0),
    total: g._count.id,
  })).sort((a, b) => b.avgScore - a.avgScore);

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
  res.json(payload);
});

// ─── RANKING GESTORES (MEJORES / PEORES) ─────────────────────────────────────

router.get('/ranking-gestores', requireRole('SUPERVISOR', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:ranking-gestores:${toScopeKey(req)}:${JSON.stringify(req.query)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const scopeFilter = buildDashboardFilter(req);
  const prevFilter = buildPrevPeriodFilter(req);

  const [actual, prev] = await Promise.all([
    prisma.evaluation.groupBy({
      by: ['gestorId'],
      where: scopeFilter,
      _avg: { score_total: true },
      _count: { id: true },
    }),
    prisma.evaluation.groupBy({
      by: ['gestorId'],
      where: prevFilter,
      _avg: { score_total: true },
    }),
  ]);

  const prevMap = Object.fromEntries(prev.map((p) => [p.gestorId, Number(p._avg.score_total ?? 0)]));

  const gestorIds = actual.map((g) => g.gestorId);
  const gestores = await prisma.gestor.findMany({
    where: { id: { in: gestorIds } },
    select: { id: true, name: true },
  });
  const gestorMap = Object.fromEntries(gestores.map((g) => [g.id, g]));

  const items = actual.map((g) => {
    const score = Number(g._avg.score_total ?? 0);
    const prevScore = prevMap[g.gestorId] ?? score;
    return {
      gestorId: g.gestorId,
      nombre: gestorMap[g.gestorId]?.name ?? '—',
      score: Math.round(score * 10) / 10,
      llamadas: g._count.id,
      tendencia: score >= prevScore ? 'up' : 'down',
    };
  }).sort((a, b) => b.score - a.score);

  const payload = {
    mejores: items.slice(0, 5),
    peores: [...items].sort((a, b) => a.score - b.score).slice(0, 5),
  };

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
  res.json(payload);
});

// ─── FALLAS TÍPICAS ───────────────────────────────────────────────────────────

const SCORE_FIELDS = [
  { key: 'ea_preg_motivo_atraso', label: 'Pregunta motivo atraso' },
  { key: 'ea_sondea_capacidad_pago', label: 'Sondeo capacidad de pago' },
  { key: 'ea_utiliza_informacion', label: 'Utiliza información' },
  { key: 'res_neg_sentido_urgencia', label: 'Sentido de urgencia' },
  { key: 'res_negociacion_total_rr', label: 'Negociación total RR' },
  { key: 'res_ofrece_herramienta', label: 'Ofrece herramienta' },
  { key: 'prev_consecuencias_beneficios', label: 'Consecuencias/beneficios' },
  { key: 'core_apertura', label: 'Apertura de llamada' },
  { key: 'core_control', label: 'Control de llamada' },
  { key: 'core_cierre', label: 'Cierre de llamada' },
  { key: 'herr_sigue_politicas', label: 'Sigue políticas' },
  { key: 'herr_explica_ofrecidas', label: 'Explica herramientas' },
  { key: 'herr_ofrece_pex', label: 'Ofrece PEX' },
  { key: 'doc_codifica', label: 'Codifica gestión' },
  { key: 'doc_gestiones_ant', label: 'Gestiones anteriores' },
  { key: 'doc_act_demograficos', label: 'Actualiza demográficos' },
  { key: 'bas_identificacion', label: 'Identificación' },
  { key: 'bas_informacion', label: 'Información correcta' },
  { key: 'bas_respeto', label: 'Respeto y tono' },
  { key: 'bas_veracidad', label: 'Veracidad' },
] as const;

router.get('/fallas-tipicas', async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:fallas-tipicas:${toScopeKey(req)}:${JSON.stringify(req.query)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const scopeFilter = buildDashboardFilter(req);

  const evs = await prisma.evaluation.findMany({
    where: scopeFilter,
    select: Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, true])) as Record<string, true>,
  });

  const rates = SCORE_FIELDS.map(({ key, label }) => {
    const applicable = evs.filter((e) => (e as Record<string, string>)[key] !== 'NO_APLICA');
    if (applicable.length === 0) return { key, label, pctNoCumple: 0, total: 0 };
    const noCumple = applicable.filter((e) => (e as Record<string, string>)[key] === 'NO_CUMPLE').length;
    return { key, label, pctNoCumple: Math.round((noCumple / applicable.length) * 1000) / 10, total: applicable.length };
  }).sort((a, b) => b.pctNoCumple - a.pctNoCumple).slice(0, 5);

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, rates);
  res.json(rates);
});

// ─── FALLAS CRÍTICAS (PIE) ────────────────────────────────────────────────────

router.get('/fallas-criticas', async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:fallas-criticas:${toScopeKey(req)}:${JSON.stringify(req.query)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const scopeFilter = buildDashboardFilter(req);

  const evs = await prisma.evaluation.findMany({
    where: scopeFilter,
    select: {
      bas_identificacion: true,
      bas_informacion: true,
      bas_respeto: true,
      herr_ofrece_pex: true,
      bas_veracidad: true,
      ea_preg_motivo_atraso: true,
      res_neg_sentido_urgencia: true,
    },
  });

  const counts = {
    'No validó identidad': 0,
    'Información incompleta': 0,
    'Tono inadecuado': 0,
    'No ofreció alternativas': 0,
    Otros: 0,
  };

  for (const ev of evs) {
    if (ev.bas_identificacion === 'NO_CUMPLE') counts['No validó identidad']++;
    if (ev.bas_informacion === 'NO_CUMPLE') counts['Información incompleta']++;
    if (ev.bas_respeto === 'NO_CUMPLE') counts['Tono inadecuado']++;
    if (ev.herr_ofrece_pex === 'NO_CUMPLE') counts['No ofreció alternativas']++;
    if (ev.bas_veracidad === 'NO_CUMPLE' || ev.ea_preg_motivo_atraso === 'NO_CUMPLE' || ev.res_neg_sentido_urgencia === 'NO_CUMPLE') counts['Otros']++;
  }

  const payload = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
  res.json(payload);
});

// ─── SCORE POR CRITERIO (RADAR) ───────────────────────────────────────────────

const RADAR_CRITERIA = [
  { label: 'Cumplimiento de Speech', fields: ['bas_informacion', 'bas_veracidad'] as const },
  { label: 'Empatía y Tono', fields: ['bas_respeto'] as const },
  { label: 'Información Correcta', fields: ['bas_informacion', 'ea_utiliza_informacion'] as const },
  { label: 'Objeciones', fields: ['res_neg_sentido_urgencia', 'res_ofrece_herramienta'] as const },
  { label: 'Cierre de Llamada', fields: ['core_cierre'] as const },
  { label: 'Cumplimiento Legal', fields: ['bas_identificacion', 'bas_veracidad'] as const },
] as const;

router.get('/score-criterios', async (req: AuthRequest, res: Response) => {
  const cacheKey = `dashboard:score-criterios:${toScopeKey(req)}:${JSON.stringify(req.query)}`;
  const cached = await getCachedJson<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const scopeFilter = buildDashboardFilter(req);
  const prevFilter = buildPrevPeriodFilter(req);

  const allFields = [...new Set(RADAR_CRITERIA.flatMap((c) => c.fields))];
  const selectFields = Object.fromEntries(allFields.map((f) => [f, true])) as Record<string, true>;

  const [evs, prevEvs] = await Promise.all([
    prisma.evaluation.findMany({ where: scopeFilter, select: selectFields }),
    prisma.evaluation.findMany({ where: prevFilter, select: selectFields }),
  ]);

  function criterioScore(list: Record<string, string>[], fields: readonly string[]): number {
    const applicable = list.flatMap((e) => fields.map((f) => e[f])).filter((v) => v !== 'NO_APLICA');
    if (applicable.length === 0) return 0;
    return Math.round((applicable.filter((v) => v === 'CUMPLE').length / applicable.length) * 1000) / 10;
  }

  const payload = RADAR_CRITERIA.map((c) => ({
    label: c.label,
    actual: criterioScore(evs as Record<string, string>[], c.fields),
    anterior: criterioScore(prevEvs as Record<string, string>[], c.fields),
  }));

  await setCachedJson(cacheKey, DASHBOARD_CACHE_TTL_SECONDS, payload);
  res.json(payload);
});

export default router;
