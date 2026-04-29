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
  TrendingDown,
  Phone,
  Award,
  AlertTriangle,
  Building2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from 'recharts';

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const BRAND_RED = '#CC0000';
const GAUGE_COLORS = [BRAND_RED, '#f0f0f0'];

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const isGestor = user?.role === 'GESTOR';
  const canSeeExtended = !isGestor;

  const [filters, setFilters] = useState<DashboardFilters>({});

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: kpisExt, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis-ext', filters],
    queryFn: () => dashboardApi.kpisExtendidos(filters).then((r) => r.data),
  });

  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['dashboard-trends', filters],
    queryFn: () => dashboardApi.trends(30).then((r) => r.data),
  });

  const { data: rankingGestores } = useQuery({
    queryKey: ['dashboard-ranking-gestores', filters],
    queryFn: () => dashboardApi.rankingGestores(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: fallasComunes } = useQuery({
    queryKey: ['dashboard-fallas-comunes', filters],
    queryFn: () => dashboardApi.fallasComunes(filters).then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: recientes, isLoading: recientesLoading } = useQuery({
    queryKey: ['evaluaciones-recientes', filters],
    queryFn: () =>
      evaluacionesApi
        .list({ limit: 8, gestorId: filters.gestorId, clienteId: filters.clienteId, fechaDesde: filters.fechaDesde, fechaHasta: filters.fechaHasta })
        .then((r) => r.data),
  });

  const { data: gestoresList } = useQuery({
    queryKey: ['gestores-list'],
    queryFn: () => gestoresApi.list().then((r) => r.data),
    enabled: canSeeExtended,
  });

  const { data: clientesList } = useQuery({
    queryKey: ['clientes-list-filter'],
    queryFn: () => clientesApi.list({ isActive: true }).then((r) => r.data),
    enabled: canSeeExtended,
  });

  // ── Fallas: calcular máximo para normalizar barras ─────────────────────────
  const maxFalla = fallasComunes && fallasComunes.length > 0 ? fallasComunes[0].cantidad : 1;

  return (
    <div className="space-y-6">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">Dashboard de Auditorías</h1>
        <Link to="/evaluaciones/nueva" className="btn-primary flex items-center gap-2">
          <PlusCircle size={16} />
          Nueva Evaluación
        </Link>
      </div>

      {/* ── FILTROS GLOBALES ────────────────────────────────────────────── */}
      {canSeeExtended && (
        <DashboardFiltersBar
          filters={filters}
          onChange={setFilters}
          gestores={gestoresList ?? []}
          clientes={clientesList?.data ?? []}
        />
      )}

      {/* ── KPI CARDS ──────────────────────────────────────────────────── */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse h-32 bg-gray-100" />
          ))}
        </div>
      ) : kpisExt ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Score general con mini gauge */}
          <div className="card flex flex-col items-center py-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Score General</p>
            <div className="relative">
              <PieChart width={90} height={90}>
                <Pie
                  data={[
                    { value: kpisExt.scorePromedio },
                    { value: Math.max(0, 100 - kpisExt.scorePromedio) },
                  ]}
                  cx={40}
                  cy={40}
                  startAngle={90}
                  endAngle={-270}
                  innerRadius={28}
                  outerRadius={40}
                  dataKey="value"
                  strokeWidth={0}
                >
                  <Cell fill={BRAND_RED} />
                  <Cell fill="#f0f0f0" />
                </Pie>
              </PieChart>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-brand-dark">
                {kpisExt.scorePromedio.toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="card flex flex-col justify-center">
            <div className="text-brand-red mb-1"><Phone size={20} /></div>
            <p className="text-3xl font-bold text-brand-dark">{kpisExt.llamadasAuditadas.toLocaleString('es-AR')}</p>
            <p className="text-xs text-gray-500 mt-0.5">Llamadas auditadas</p>
          </div>

          <div className="card flex flex-col justify-center">
            <div className="text-brand-red mb-1"><Award size={20} /></div>
            <p className="text-3xl font-bold text-brand-dark">{kpisExt.promesasDePago.toLocaleString('es-AR')}</p>
            <p className="text-xs text-gray-500 mt-0.5">Promesas de pago</p>
          </div>

          <div className="card flex flex-col justify-center">
            <div className="text-green-600 mb-1"><TrendingUp size={20} /></div>
            <p className="text-3xl font-bold text-brand-dark">{kpisExt.mejorScore.toFixed(1)}%</p>
            <p className="text-xs text-gray-500 mt-0.5">Mejor score del período</p>
          </div>
        </div>
      ) : null}

      {/* ── TENDENCIA + RANKING ─────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Gráfico de tendencia */}
        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-red" />
            Evolución de Scores (últimos 30 días)
          </h3>
          {trendsLoading ? (
            <div className="h-48 bg-gray-100 animate-pulse rounded-lg" />
          ) : trends && trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number | string) => `${Number(v).toFixed(1)}%`} />
                <Legend />
                <Line type="monotone" dataKey="avgTotal" name="Total" stroke={BRAND_RED} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="avgCore" name="Core" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="avgBasics" name="Basics" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">Sin datos para este período</p>
          )}
        </div>

        {/* Resumen rápido peor score */}
        {kpisExt && (
          <div className="card flex flex-col justify-center gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mejor score</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{kpisExt.mejorScore.toFixed(1)}%</p>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Peor score</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{kpisExt.peorScore.toFixed(1)}%</p>
            </div>
          </div>
        )}
      </div>

      {/* ── RANKING MEJORES / PEORES ─────────────────────────────────────── */}
      {canSeeExtended && rankingGestores && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-green-600" />
              Mejores Operadores
            </h3>
            <RankingTable items={rankingGestores.mejores} variant="mejores" />
          </div>
          <div className="card">
            <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
              <TrendingDown size={16} className="text-red-500" />
              Operadores a Mejorar
            </h3>
            <RankingTable items={rankingGestores.peores} variant="peores" />
          </div>
        </div>
      )}

      {/* ── FALLAS MÁS COMUNES ──────────────────────────────────────────── */}
      {canSeeExtended && fallasComunes && fallasComunes.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-5 flex items-center gap-2">
            <AlertTriangle size={16} className="text-brand-red" />
            Fallas más Comunes
          </h3>
          <div className="space-y-3">
            {fallasComunes.map((f) => (
              <div key={f.criterio} className="flex items-center gap-3">
                <p className="text-sm text-gray-700 w-64 shrink-0 truncate" title={f.label}>
                  {f.label}
                </p>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-red transition-all"
                    style={{ width: `${(f.cantidad / maxFalla) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-gray-500 w-16 text-right shrink-0">
                  {f.cantidad} ({f.porcentaje.toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ÚLTIMAS AUDITORÍAS ──────────────────────────────────────────── */}
      <div className="card">
        <h3 className="font-semibold text-brand-dark mb-4">Últimas Auditorías</h3>
        {recientesLoading ? (
          <div className="h-28 bg-gray-100 animate-pulse rounded-lg" />
        ) : recientes && recientes.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pr-4">Call ID</th>
                  <th className="pb-2 pr-4">Gestor</th>
                  {!isGestor && <th className="pb-2 pr-4">Cliente</th>}
                  <th className="pb-2 pr-4">Score</th>
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
                    {!isGestor && (
                      <td className="py-2 pr-4 text-gray-500">
                        {ev.cliente ? `${ev.cliente.icono ?? ''} ${ev.cliente.nombre}` : '—'}
                      </td>
                    )}
                    <td className="py-2 pr-4">
                      <ScoreDisplay score={ev.score_total} />
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={ev.status} />
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(ev.capture_date).toLocaleDateString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">No hay auditorías para mostrar</p>
        )}
      </div>
    </div>
  );
}

// ─── BARRA DE FILTROS ─────────────────────────────────────────────────────────
function DashboardFiltersBar({
  filters,
  onChange,
  gestores,
  clientes,
}: {
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  gestores: Array<{ id: string; name: string }>;
  clientes: Array<{ id: string; nombre: string; icono?: string | null }>;
}) {
  const hasFilters = !!(filters.clienteId || filters.gestorId || filters.fechaDesde || filters.fechaHasta);

  function set(key: keyof DashboardFilters, val: string) {
    onChange({ ...filters, [key]: val || undefined });
  }

  return (
    <div className="card py-3">
      <div className="flex flex-wrap gap-3 items-end">
        {clientes.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
              <Building2 size={12} /> Cliente
            </label>
            <select value={filters.clienteId ?? ''} onChange={(e) => set('clienteId', e.target.value)} className="input w-auto text-sm">
              <option value="">Todos</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>
              ))}
            </select>
          </div>
        )}
        {gestores.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
              <Users size={12} /> Operador
            </label>
            <select value={filters.gestorId ?? ''} onChange={(e) => set('gestorId', e.target.value)} className="input w-auto text-sm">
              <option value="">Todos</option>
              {gestores.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
          <input type="date" value={filters.fechaDesde ?? ''} onChange={(e) => set('fechaDesde', e.target.value)} className="input w-auto text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
          <input type="date" value={filters.fechaHasta ?? ''} onChange={(e) => set('fechaHasta', e.target.value)} className="input w-auto text-sm" />
        </div>
        {hasFilters && (
          <button onClick={() => onChange({})} className="btn-secondary flex items-center gap-1 text-sm">
            <X size={14} /> Limpiar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── RANKING TABLE ────────────────────────────────────────────────────────────
function RankingTable({
  items,
  variant,
}: {
  items: Array<{ gestorId: string; nombre: string; score: number; llamadas: number; tendencia: 'up' | 'down' }>;
  variant: 'mejores' | 'peores';
}) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">Sin datos para el período seleccionado</p>;
  }

  const MEDALS = ['🥇', '🥈', '🥉', '4°', '5°'];

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.gestorId} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
          <span className="text-sm w-7 shrink-0 text-center">{MEDALS[i] ?? `${i + 1}°`}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.nombre}</p>
            <p className="text-xs text-gray-400">{item.llamadas} llamadas</p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-sm font-bold ${variant === 'mejores' ? 'text-green-600' : 'text-red-600'}`}>
              {item.score.toFixed(1)}%
            </p>
            <span className={`text-xs font-semibold ${item.tendencia === 'up' ? 'text-green-500' : 'text-red-400'}`}>
              {item.tendencia === 'up' ? '↑' : '↓'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
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
