import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useEvaluacion, useScoreEvaluacion, useAnalyzeDebtor, useCompleteEvaluacion } from '../hooks/useEvaluation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AudioUploader from '../components/AudioUploader';
import TranscriptViewer from '../components/TranscriptViewer';
import ScoringTable from '../components/ScoringTable';
import DebtorAnalysisCard from '../components/DebtorAnalysisCard';
import PDFExportButton from '../components/PDFExportButton';
import ScoreDisplay from '../components/ScoreDisplay';
import { ArrowLeft, Brain, CheckCircle } from 'lucide-react';
import DOMPurify from 'dompurify';
import { evaluacionesApi } from '../services/api.service';

export default function EvaluationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: evaluation, isLoading, error, refetch: refetchEvaluation } = useEvaluacion(id!);
  const { data: processingStatus } = useQuery({
    queryKey: ['evaluation-status', id],
    queryFn: () => evaluacionesApi.status(id!).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  });
  const { mutate: score, isPending: scoring, isError: scoringError } = useScoreEvaluacion(id!);
  const { mutate: analyzeDebtor, isPending: analyzing } = useAnalyzeDebtor(id!);
  const { mutate: complete, isPending: completing } = useCompleteEvaluacion(id!);

  const autoScoreTriggeredRef = useRef(false);
  const autoDebtorTriggeredRef = useRef(false);

  const hasAudio = !!evaluation?.audio_path;
  const hasTranscript = !!evaluation?.transcript;
  const transcriptReady = hasTranscript || processingStatus?.status === 'ready';
  const hasScoringResult = evaluation ? hasEvaluationResult(evaluation) : false;
  const hasDebtor = !!evaluation?.debtor_analysis;
  const isDraft = evaluation?.status === 'DRAFT';
  const isTranscribing = !!hasAudio && !transcriptReady;
  const isScoring = (transcriptReady && !hasScoringResult) || scoring;

  useEffect(() => {
    if (!id || !processingStatus?.status) return;
    void refetchEvaluation();
    void queryClient.invalidateQueries({ queryKey: ['evaluacion', id] });
  }, [id, processingStatus?.status, queryClient, refetchEvaluation]);

  useEffect(() => {
    if (!evaluation) return;
    if (!transcriptReady || hasScoringResult || scoring || autoScoreTriggeredRef.current) return;
    autoScoreTriggeredRef.current = true;
    score(undefined, {
      onError: () => {
        autoScoreTriggeredRef.current = false;
      },
    });
  }, [evaluation, transcriptReady, hasScoringResult, scoring, score]);

  useEffect(() => {
    if (!evaluation) return;
    if (!hasScoringResult || hasDebtor || analyzing || autoDebtorTriggeredRef.current) return;
    autoDebtorTriggeredRef.current = true;
    analyzeDebtor(undefined, {
      onError: () => {
        autoDebtorTriggeredRef.current = false;
      },
    });
  }, [evaluation, hasScoringResult, hasDebtor, analyzing, analyzeDebtor]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="animate-spin h-8 w-8 border-4 border-brand-red border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !evaluation) {
    return (
      <div className="card text-center text-red-600">
        Error cargando la evaluación.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-dark mb-2"
          >
            <ArrowLeft size={14} /> Volver al Dashboard
          </button>
          <h1 className="text-2xl font-bold text-brand-dark">
            Evaluación — <span className="text-brand-red">{evaluation.call_id}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestor: <strong>{evaluation.gestor?.name}</strong> ·
            Auditor: <strong>{evaluation.auditor?.name}</strong> ·
            {new Date(evaluation.capture_date).toLocaleDateString('es-AR')}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <PDFExportButton evaluacionId={id!} callId={evaluation.call_id} />
          {isDraft && hasScoringResult && (
            <button
              onClick={() => complete(undefined)}
              disabled={completing}
              className="btn-primary flex items-center gap-2"
            >
              {completing ? (
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <CheckCircle size={16} />
              )}
              Completar
            </button>
          )}
        </div>
      </div>

      {/* Info + Score */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoItem label="N° de Cuenta" value={evaluation.account_number} />
        <InfoItem label="N° de Asignación" value={evaluation.assignment_number} />
        <InfoItem label="Tipo de Contacto" value={evaluation.contact_type} />
        <InfoItem label="Estado" value={<StatusBadge status={evaluation.status} />} />
      </div>

      <EvaluationProgressBar
        isTranscribing={isTranscribing}
        isScoring={isScoring}
        hasResult={hasScoringResult}
      />

      {/* Score summary */}
      {hasScoringResult && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <ScoreDisplay score={evaluation.score_total} label="RESULTADO FINAL" size="lg" />
            <ScoreDisplay score={evaluation.score_core} label="CORE (50%)" size="lg" />
            <ScoreDisplay score={evaluation.score_basics} label="BASICS (35%)" size="lg" />
          </div>
          {hasCalculationBreakdown(evaluation.ai_scoring_raw) && (
            <div className="card">
              <h3 className="text-sm font-semibold text-brand-dark mb-3">Desglose del Resultado</h3>
              <div className="grid gap-2 md:grid-cols-3">
                {getCalculationBuckets(evaluation.ai_scoring_raw).map((bucket) => (
                  <div key={bucket.key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-semibold text-gray-500">{bucket.label}</p>
                    <p className="mt-1 text-sm font-semibold text-brand-dark">{formatBucketScore(bucket.score)}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Peso aplicado: {(bucket.normalizedWeight * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500">
                      Cumple: {bucket.cumple} · No cumple: {bucket.noCumple} · No aplica: {bucket.noAplica}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DebtorIdentitySummary evaluation={evaluation} />
        </>
      )}

      {/* Flags */}
      {(evaluation.flag_llamada_cortada || evaluation.flag_problema_calidad || evaluation.flag_problema_sonido ||
        evaluation.flag_sistema_lento || evaluation.flag_conectividad || evaluation.flag_empatia_covid) && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-3">Flags</h3>
          <div className="flex flex-wrap gap-2">
            {evaluation.flag_llamada_cortada && <Flag label="Llamada Cortada" />}
            {evaluation.flag_problema_calidad && <Flag label="Problema Calidad" />}
            {evaluation.flag_problema_sonido && <Flag label="Problema Sonido" />}
            {evaluation.flag_sistema_lento && <Flag label="Sistema Lento" />}
            {evaluation.flag_conectividad && <Flag label="Conectividad" />}
            {evaluation.flag_empatia_covid && <Flag label="Empatía COVID" />}
          </div>
        </div>
      )}

      {/* Audio Upload */}
      <div className="card">
        <h3 className="font-semibold text-brand-dark mb-4">Audio de la Llamada</h3>
        {hasAudio ? (
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>✅ Audio subido: <strong>{evaluation.audio_filename}</strong></span>
            {evaluation.audio_duration_s && (
              <span className="text-gray-400">({Math.floor(evaluation.audio_duration_s / 60)}:{String(evaluation.audio_duration_s % 60).padStart(2, '0')} min)</span>
            )}
          </div>
        ) : (
          <AudioUploader evaluacionId={id!} />
        )}
      </div>

      {/* Transcript */}
      {(hasAudio || hasTranscript) && (
        <div className="card">
          {processingStatus?.status === 'processing' && (
            <div className="mb-3 text-sm text-blue-700 bg-blue-50 rounded-lg p-2">
              Procesando transcripcion... se actualiza automaticamente.
            </div>
          )}
          <TranscriptViewer evaluacionId={id!} transcript={evaluation.transcript} />
        </div>
      )}

      {/* AI Actions */}
      {hasTranscript && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-4">Proceso de IA</h3>
          <div className="flex flex-wrap gap-3">
            {isScoring && (
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 text-blue-700 text-sm font-medium">
                <span className="animate-spin h-4 w-4 border-2 border-blue-700 border-t-transparent rounded-full" />
                Evaluando diálogo con IA...
              </div>
            )}

            {!isScoring && !hasScoringResult && scoringError && (
              <button
                onClick={() => score(undefined)}
                className="btn-primary"
              >
                Reintentar evaluación automática
              </button>
            )}
          </div>
        </div>
      )}

      {/* Scoring Table */}
      {hasScoringResult && (
        <div>
          <h2 className="text-lg font-bold text-brand-dark mb-3">Rúbrica de Evaluación</h2>
          <ScoringTable evaluation={evaluation} />
        </div>
      )}

      {/* Debtor Analysis */}
      {hasScoringResult && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-4 flex items-center gap-2">
            <Brain size={16} className="text-brand-red" />
            Análisis del Deudor
          </h3>

          {hasDebtor && evaluation.debtor_analysis ? (
            <DebtorAnalysisCard analysis={evaluation.debtor_analysis} />
          ) : analyzing ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 text-blue-700 text-sm font-medium">
              <span className="animate-spin h-4 w-4 border-2 border-blue-700 border-t-transparent rounded-full" />
              Generando análisis del deudor...
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              El análisis del deudor se genera automáticamente al finalizar el scoring.
            </p>
          )}
        </div>
      )}

      {/* Observaciones */}
      {evaluation.observaciones && (
        <div className="card">
          <h3 className="font-semibold text-brand-dark mb-2">Observaciones</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {DOMPurify.sanitize(evaluation.observaciones, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })}
          </p>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
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

function Flag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-1 rounded-md bg-orange-100 text-orange-700 text-xs font-medium">
      ⚠️ {label}
    </span>
  );
}

function EvaluationProgressBar({
  isTranscribing,
  isScoring,
  hasResult,
}: {
  isTranscribing: boolean;
  isScoring: boolean;
  hasResult: boolean;
}) {
  const transcripcionDone = !isTranscribing;
  const evaluandoDone = hasResult;
  const resultadoDone = hasResult;

  const barPercent = hasResult ? 100 : isScoring ? 66 : isTranscribing ? 33 : 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
        <span className={transcripcionDone ? 'text-green-700' : 'text-brand-red'}>1. Transcripción</span>
        <span className={evaluandoDone ? 'text-green-700' : isScoring ? 'text-brand-red' : 'text-gray-500'}>2. Evaluando Diálogo</span>
        <span className={resultadoDone ? 'text-green-700' : 'text-gray-500'}>3. Resultado</span>
      </div>

      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-red transition-all duration-500"
          style={{ width: `${barPercent}%` }}
        />
      </div>

      <p className="text-sm text-gray-600">
        {hasResult
          ? 'Resultado listo. Podés revisar el detalle por criterio y su justificación.'
          : isScoring
            ? 'Evaluando diálogo con IA...'
            : isTranscribing
              ? 'Transcribiendo audio...'
              : 'Esperando audio para iniciar la evaluación.'}
      </p>
    </div>
  );
}

function hasEvaluationResult(evaluation: { ai_scoring_raw: object | null; score_total: number; score_core: number; score_basics: number }) {
  if (evaluation.ai_scoring_raw) return true;
  const hasNonZeroScore = Number(evaluation.score_total) > 0 || Number(evaluation.score_core) > 0 || Number(evaluation.score_basics) > 0;
  return hasNonZeroScore;
}

function hasCalculationBreakdown(
  raw: { calculation?: { breakdown?: unknown } } | null | undefined,
): raw is { calculation: { breakdown: { core: BucketLike; basics: BucketLike; other: BucketLike; normalized_weights: WeightLike } } } {
  return Boolean(raw?.calculation?.breakdown);
}

function getCalculationBuckets(raw: {
  calculation: {
    breakdown: {
      core: BucketLike;
      basics: BucketLike;
      other: BucketLike;
      normalized_weights: WeightLike;
    };
  };
}) {
  const breakdown = raw.calculation.breakdown;
  return [
    {
      key: 'core',
      label: 'CORE',
      score: breakdown.core.score,
      cumple: breakdown.core.cumple,
      noCumple: breakdown.core.no_cumple,
      noAplica: breakdown.core.no_aplica,
      normalizedWeight: breakdown.normalized_weights.core,
    },
    {
      key: 'basics',
      label: 'BASICS',
      score: breakdown.basics.score,
      cumple: breakdown.basics.cumple,
      noCumple: breakdown.basics.no_cumple,
      noAplica: breakdown.basics.no_aplica,
      normalizedWeight: breakdown.normalized_weights.basics,
    },
    {
      key: 'other',
      label: 'RESTO',
      score: breakdown.other.score,
      cumple: breakdown.other.cumple,
      noCumple: breakdown.other.no_cumple,
      noAplica: breakdown.other.no_aplica,
      normalizedWeight: breakdown.normalized_weights.other,
    },
  ];
}

function formatBucketScore(score: number | null | undefined): string {
  return typeof score === 'number' ? `${score.toFixed(1)}%` : 'Sin criterios aplicables';
}

function DebtorIdentitySummary({ evaluation }: { evaluation: { debtor_analysis?: { justificacion_detalle: string; ai_raw_response?: { deudor_nombre?: string | null; motivo_no_pago_resumen?: string } | null } | null } }) {
  const debtorName = (evaluation.debtor_analysis?.ai_raw_response?.deudor_nombre ?? '').trim();
  const nonPaymentReason =
    (evaluation.debtor_analysis?.ai_raw_response?.motivo_no_pago_resumen ?? '').trim() ||
    evaluation.debtor_analysis?.justificacion_detalle ||
    'No hay análisis de deudor todavía.';

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-brand-dark mb-2">Perfil del Deudor (IA)</h3>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Nombre detectado</p>
          <p className="text-sm font-semibold text-brand-dark">
            {debtorName || 'No identificado explícitamente'}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Motivo principal de no pago</p>
          <p className="text-sm text-gray-700">{nonPaymentReason}</p>
        </div>
      </div>
    </div>
  );
}

interface BucketLike {
  score: number | null;
  cumple: number;
  no_cumple: number;
  no_aplica: number;
}

interface WeightLike {
  core: number;
  basics: number;
  other: number;
}
