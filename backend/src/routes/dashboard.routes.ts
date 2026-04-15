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

export default router;
