import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, evaluacionesApi } from '../services/api.service';
import ScoreDisplay from '../components/ScoreDisplay';
import { PlusCircle, TrendingUp, Users, ClipboardList } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export default function Dashboard() {
  const { user } = useAuth();
  const isGestor = user?.role === 'GESTOR';

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => dashboardApi.kpis().then((r) => r.data),
  });

  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['dashboard-trends'],
    queryFn: () => dashboardApi.trends(30).then((r) => r.data),
  });

  const { data: recientes } = useQuery({
    queryKey: ['evaluaciones-recientes'],
    queryFn: () => evaluacionesApi.list({ limit: 5 }).then((r) => r.data),
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

      {/* KPI Cards */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-100" />
          ))}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Total Evaluaciones"
            value={kpis.totalEvaluaciones}
            icon={<ClipboardList size={20} />}
          />
          <KpiCard
            label="Completadas"
            value={kpis.completadas}
            icon={<ClipboardList size={20} />}
            color="green"
          />
          <KpiCard
            label="Puntaje Promedio"
            value={<ScoreDisplay score={kpis.avgScoreTotal} />}
            icon={<TrendingUp size={20} />}
          />
          <KpiCard
            label={isGestor ? 'Mejor Score' : 'Gestores Evaluados'}
            value={isGestor ? <ScoreDisplay score={kpis.bestScore ?? 0} /> : (kpis.topGestores?.length ?? 0)}
            icon={<Users size={20} />}
          />
        </div>
      ) : null}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Trends chart */}
        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-brand-red" />
            Evolución de Puntajes (últimos 30 días)
          </h3>
          {trendsLoading ? (
            <div className="h-48 bg-gray-100 animate-pulse rounded-lg" />
          ) : (trends && trends.length > 0) ? (
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

        {/* Top gestores */}
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

      {/* Evaluaciones recientes */}
      {recientes && recientes.data.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-4">Evaluaciones Recientes</h3>
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
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  color?: 'green';
}) {
  return (
    <div className="card">
      <div className={`text-brand-red mb-2 ${color === 'green' ? 'text-green-600' : ''}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-brand-dark">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
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
