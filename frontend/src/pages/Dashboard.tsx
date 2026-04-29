import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  dashboardApi,
  evaluacionesApi,
  gestoresApi,
  clientesApi,
  DashboardFilters,
} from '../services/api.service';
import ScoreDisplay from '../components/ScoreDisplay';
import {
  PlusCircle,
  TrendingUp,
  Users,
  ClipboardList,
  Mic,
  Banknote,
  HandCoins,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';

const PIE_COLORS = ['#CC0000', '#2563eb', '#16a34a', '#d97706', '#6b7280'];

export default function Dashboard() {
  const { user } = useAuth();
  const isGestor = user?.role === 'GESTOR';
  const canSeeExtended = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR' || user?.role === 'AUDITOR';

  const [filters, setFilters] = useState<DashboardFilters>({});

  function setFilter<K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
  }

  function clearFilters() {
    setFilters({});
  }

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis', filters],
    queryFn: () => dashboardApi.kpis(filters).then((r) => r.data),
  });

  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['dashboard-trends'],
    queryFn: () => dashboardApi.trends(30).then((r) => r.data),
  });

  const { data: recientes, isLoading: recientesLoading } = useQuery({
    queryKey: ['evaluaciones-recientes'],
    queryFn: () => evaluacionesApi.list({ limit: 5 }).then((r) => r.data),
  });

  const { data: kpisExt } = useQuery({
    queryKey: ['dashboard-kpis-extended', filters],
    queryFn: () => dashboardApi.kpisExtended(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: scorePorCliente } = useQuery({
    queryKey: ['dashboard-score-por-cliente', filters],
    queryFn: () => dashboardApi.scorePorCliente(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: rankingGestores } = useQuery({
    queryKey: ['dashboard-ranking-gestores', filters],
    queryFn: () => dashboardApi.rankingGestores(filters).then((r) => r.data),
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPERVISOR',
  });

  const { data: fallasTipicas } = useQuery({
    queryKey: ['dashboard-fallas-tipicas', filters],
    queryFn: () => dashboardApi.fallasTipicas(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: fallasCriticas } = useQuery({
    queryKey: ['dashboard-fallas-criticas', filters],
    queryFn: () => dashboardApi.fallasCriticas(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: scoreCriterios } = useQuery({
    queryKey: ['dashboard-score-criterios', filters],
    queryFn: () => dashboardApi.scoreCriterios(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: gestoresList } = useQuery({
    queryKey: ['gestores-list'],
    queryFn: () => gestoresApi.list().then((r) => r.data),
    enabled: !isGestor,
  });

  const { data: clientesList } = useQuery({
    queryKey: ['clientes-list-filter'],
    queryFn: () => clientesApi.list({ isActive: true }).then((r) => r.data),
    enabled: canSeeExtended,
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">Dashboard</h1>
        <Link to="/evaluaciones/nueva" className="btn-primary flex items-center gap-2">
          <PlusCircle size={16} />
          Nueva Evaluación
        </Link>
      </div>

      {/* ── FILTROS GLOBALES ────────────────────────────────────────── */}
      {canSeeExtended && (
        <div className="card py-4">
          <div className="flex flex-wrap gap-3 items-end">
            {clientesList && clientesList.data.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Cliente</label>
                <select
                  value={filters.clienteId ?? ''}
                  onChange={(e) => setFilter('clienteId', e.target.value)}
                  className="input w-auto text-sm"
                >
                  <option value="">Todos los clientes</option>
                  {clientesList.data.map((c) => (
                    <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>
                  ))}
                </select>
              </div>
            )}
            {!isGestor && gestoresList && gestoresList.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Gestor</label>
                <select
                  value={filters.gestorId ?? ''}
                  onChange={(e) => setFilter('gestorId', e.target.value)}
                  className="input w-auto text-sm"
                >
                  <option value="">Todos los gestores</option>
                  {gestoresList.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
              <input
                type="date"
                value={filters.fechaDesde ?? ''}
                onChange={(e) => setFilter('fechaDesde', e.target.value)}
                className="input w-auto text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
              <input
                type="date"
                value={filters.fechaHasta ?? ''}
                onChange={(e) => setFilter('fechaHasta', e.target.value)}
                className="input w-auto text-sm"
              />
            </div>
            {(filters.clienteId || filters.gestorId || filters.fechaDesde || filters.fechaHasta) && (
              <button onClick={clearFilters} className="btn-secondary text-sm">
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── KPI CARDS BASE ──────────────────────────────────────────── */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-100" />
          ))}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Evaluaciones" value={kpis.totalEvaluaciones} icon={<ClipboardList size={20} />} />
          <KpiCard label="Completadas" value={kpis.completadas} icon={<ClipboardList size={20} />} color="green" />
          <KpiCard label="Puntaje Promedio" value={<ScoreDisplay score={kpis.avgScoreTotal} />} icon={<TrendingUp size={20} />} />
          <KpiCard
            label={isGestor ? 'Mejor Score' : 'Gestores Evaluados'}
            value={isGestor ? <ScoreDisplay score={kpis.bestScore ?? 0} /> : (kpis.topGestores?.length ?? 0)}
            icon={<Users size={20} />}
          />
        </div>
      ) : null}

      {/* ── KPIs EXTENDIDOS ─────────────────────────────────────────── */}
      {canSeeExtended && kpisExt && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard
            label="Cumplimiento de Speech"
            value={`${kpisExt.cumplimientoSpeech.toFixed(1)}%`}
            icon={<Mic size={20} />}
            delta={kpisExt.cumplimientoSpeechDelta}
          />
          <KpiCard
            label="Promesas de Pago"
            value={`${kpisExt.promesasDePago.toFixed(1)}%`}
            icon={<HandCoins size={20} />}
          />
          <KpiCard
            label="Monto Recuperado"
            value={`$${kpisExt.montoRecuperado.toLocaleString('es-AR')}`}
            icon={<Banknote size={20} />}
          />
        </div>
      )}

      {/* ── TRENDS + TOP GESTORES ───────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-red" />
            Evolución de Puntajes (últimos 30 días)
          </h3>
          {trendsLoading ? (
            <div className="h-48 bg-gray-100 animate-pulse rounded-lg" />
          ) : trends && trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number | string) => `${Number(v).toFixed(1)}%`} />
                <Legend />
                <Line type="monotone" dataKey="avgTotal" name="Total" stroke="#CC0000" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="avgCore" name="Core" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="avgBasics" name="Basics" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">Sin datos aún</p>
          )}
        </div>

        {kpis && !isGestor && (kpis.topGestores?.length ?? 0) > 0 && (
          <div className="card">
            <h3 className="font-semibold text-brand-dark mb-4">Top Gestores</h3>
            <ul className="space-y-2">
              {(kpis.topGestores ?? []).map((g, i) => (
                <li key={g.gestor?.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{g.gestor?.name}</p>
                    <p className="text-xs text-gray-400">{g.totalEvaluaciones} evaluaciones</p>
                  </div>
                  {g.avgScore != null && <ScoreDisplay score={g.avgScore} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── SCORE POR CLIENTE ───────────────────────────────────────── */}
      {canSeeExtended && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-4">Score General por Cliente</h3>
          {!scorePorCliente || scorePorCliente.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sin datos de clientes aún — asigná clientes a las evaluaciones</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={scorePorCliente} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number | string) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="avgScore" name="Score promedio" radius={[4, 4, 0, 0]}>
                  {scorePorCliente.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* ── RANKING MEJORES / PEORES ─────────────────────────────────── */}
      {rankingGestores && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-green-600" /> Mejores Scores
            </h3>
            <RankingTable items={rankingGestores.mejores} />
          </div>
          <div className="card">
            <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" /> Peores Scores
            </h3>
            <RankingTable items={rankingGestores.peores} invertColors />
          </div>
        </div>
      )}

      {/* ── FALLAS TÍPICAS + FALLAS CRÍTICAS ─────────────────────────── */}
      {canSeeExtended && (fallasTipicas || fallasCriticas) && (
        <div className="grid md:grid-cols-2 gap-6">
          {fallasTipicas && fallasTipicas.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-brand-dark mb-4">¿Dónde está la falla típica?</h3>
              <div className="space-y-3">
                {fallasTipicas.map((f) => (
                  <div key={f.key}>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>{f.label}</span>
                      <span className="font-semibold">{f.pctNoCumple.toFixed(1)}% NO CUMPLE</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-red rounded-full"
                        style={{ width: `${Math.min(f.pctNoCumple, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fallasCriticas && fallasCriticas.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-brand-dark mb-4">Fallas Críticas más Comunes</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={fallasCriticas}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {fallasCriticas.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── RADAR DE CRITERIOS ──────────────────────────────────────── */}
      {canSeeExtended && scoreCriterios && scoreCriterios.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-4">Score por Criterio de Evaluación</h3>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart cx="50%" cy="50%" outerRadius={100} data={scoreCriterios}>
              <PolarGrid />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Radar name="Período actual" dataKey="actual" stroke="#CC0000" fill="#CC0000" fillOpacity={0.25} />
              <Radar name="Período anterior" dataKey="anterior" stroke="#2563eb" fill="#2563eb" fillOpacity={0.1} />
              <Legend />
              <Tooltip formatter={(v: number | string) => `${Number(v).toFixed(1)}%`} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── EVALUACIONES RECIENTES ──────────────────────────────────── */}
      <div className="card">
        <h3 className="font-semibold text-brand-dark mb-4">Evaluaciones Recientes</h3>
        {recientesLoading ? (
          <div className="h-28 bg-gray-100 animate-pulse rounded-lg" />
        ) : recientes && recientes.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pr-4">Call ID</th>
                  <th className="pb-2 pr-4">Gestor</th>
                  <th className="pb-2 pr-4">Puntaje</th>
                  <th className="pb-2 pr-4">Estado</th>
                  <th className="pb-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recientes.data.map((ev) => (
                  <tr key={ev.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-4">
                      <Link to={`/evaluaciones/${ev.id}`} className="text-brand-red hover:underline font-medium">
                        {ev.call_id}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{ev.gestor?.name ?? '—'}</td>
                    <td className="py-2 pr-4"><ScoreDisplay score={ev.score_total} /></td>
                    <td className="py-2 pr-4"><StatusBadge status={ev.status} /></td>
                    <td className="py-2 text-gray-500">{new Date(ev.capture_date).toLocaleDateString('es-AR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">No hay evaluaciones recientes</p>
        )}
      </div>
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  color,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  color?: 'green';
  delta?: number;
}) {
  return (
    <div className="card">
      <div className={`mb-2 ${color === 'green' ? 'text-green-600' : 'text-brand-red'}`}>{icon}</div>
      <p className="text-2xl font-bold text-brand-dark">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {delta !== undefined && (
        <p className={`text-xs font-semibold mt-1 ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}% vs período anterior
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-yellow-100 text-yellow-800',
    COMPLETED: 'bg-green-100 text-green-800',
    REVIEWED: 'bg-blue-100 text-blue-800',
  };
  const labels: Record<string, string> = {
    DRAFT: 'Borrador',
    COMPLETED: 'Completada',
    REVIEWED: 'Revisada',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function RankingTable({
  items,
  invertColors,
}: {
  items: Array<{ gestorId: string; nombre: string; score: number; llamadas: number; tendencia: 'up' | 'down' }>;
  invertColors?: boolean;
}) {
  if (items.length === 0) return <p className="text-sm text-gray-400 text-center py-4">Sin datos</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-200">
          <th className="pb-2 pr-3">Gestor</th>
          <th className="pb-2 pr-3 text-right">Score</th>
          <th className="pb-2 pr-3 text-right">Llamadas</th>
          <th className="pb-2 text-right">Tendencia</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.gestorId} className="border-b border-gray-100 last:border-0">
            <td className="py-2 pr-3 font-medium truncate max-w-[140px]">{item.nombre}</td>
            <td className="py-2 pr-3 text-right">
              <span className={`font-bold ${invertColors ? 'text-red-600' : 'text-green-600'}`}>
                {item.score.toFixed(1)}%
              </span>
            </td>
            <td className="py-2 pr-3 text-right text-gray-500">{item.llamadas}</td>
            <td className="py-2 text-right">
              <span className={item.tendencia === 'up' ? 'text-green-600' : 'text-red-500'}>
                {item.tendencia === 'up' ? '↑' : '↓'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
