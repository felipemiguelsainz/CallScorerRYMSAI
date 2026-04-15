import { DebtorAnalysis } from '../services/api.service';
import { AlertTriangle, CheckCircle, Calendar, DollarSign } from 'lucide-react';
import DOMPurify from 'dompurify';

interface Props {
  analysis: DebtorAnalysis;
}

const conflictColors = {
  BAJO: 'bg-green-100 text-green-800',
  MEDIO: 'bg-orange-100 text-orange-800',
  ALTO: 'bg-red-100 text-red-800',
};

const justificacionLabels: Record<string, string> = {
  NO_CONOCIA_DEUDA: 'No conocía la deuda',
  SIN_DINERO: 'Sin dinero',
  DISPUTA_MONTO: 'Disputa el monto',
  DESEMPLEO: 'Desempleo',
  PROBLEMA_SALUD: 'Problema de salud',
  OLVIDO: 'Olvido',
  ACUERDO_PREVIO: 'Acuerdo previo',
  NIEGA_DEUDA: 'Niega la deuda',
  PROMESA_PAGO: 'Promesa de pago',
  OTRA: 'Otra',
};

export default function DebtorAnalysisCard({ analysis }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Justificación</p>
          <p className="text-sm font-semibold">
            {justificacionLabels[analysis.justificacion_tipo] ?? analysis.justificacion_tipo}
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Nivel de Conflicto</p>
          <span
            className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${conflictColors[analysis.nivel_conflicto]}`}
          >
            {analysis.nivel_conflicto}
          </span>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
            <CheckCircle size={12} /> Promesa de Pago
          </p>
          <p
            className={`text-sm font-semibold ${analysis.promesa_de_pago ? 'text-green-600' : 'text-gray-600'}`}
          >
            {analysis.promesa_de_pago ? 'Sí' : 'No'}
          </p>
        </div>

        {analysis.promesa_de_pago && (
          <>
            {analysis.fecha_promesa && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Calendar size={12} /> Fecha Promesa
                </p>
                <p className="text-sm font-semibold">
                  {new Date(analysis.fecha_promesa).toLocaleDateString('es-AR')}
                </p>
              </div>
            )}
            {analysis.monto_prometido && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <DollarSign size={12} /> Monto Prometido
                </p>
                <p className="text-sm font-semibold">
                  ${analysis.monto_prometido.toLocaleString('es-AR')}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
          <AlertTriangle size={12} /> Detalle de Justificación
        </p>
        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
          {DOMPurify.sanitize(analysis.justificacion_detalle, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: [],
          })}
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-1">Resumen de la Situación</p>
        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
          {DOMPurify.sanitize(analysis.resumen_situacion, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}
        </p>
      </div>
    </div>
  );
}
