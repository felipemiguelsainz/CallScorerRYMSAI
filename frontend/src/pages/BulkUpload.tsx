import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, XCircle, Clock, AlertCircle, RefreshCw, ExternalLink, ChevronRight } from 'lucide-react';
import { evaluacionesApi, gestoresApi, clientesApi } from '../services/api.service';
import type { BulkUploadResult, Gestor, Cliente } from '../services/api.service';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluacionesApi as evalApi } from '../services/api.service';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadStatus = 'pending' | 'queued' | 'skipped' | 'error';
type ProcessStatus = 'idle' | 'processing' | 'ready' | 'error';

interface FileRow {
  call_id: string;
  fileName: string;
  evalId?: string;
  uploadStatus: UploadStatus;
  reason?: string;
}

interface StatusResult {
  status: ProcessStatus;
  score_total?: number;
  nivel_conflicto?: string | null;
}

// ─── Status polling ───────────────────────────────────────────────────────────

function useStatusPoll(evalId: string | undefined, enabled: boolean) {
  return useQuery<StatusResult>({
    queryKey: ['bulk-status', evalId],
    queryFn: () => evalApi.status(evalId!).then((r) => r.data as StatusResult),
    enabled: enabled && !!evalId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return !s || s === 'processing' ? 3000 : false;
    },
  });
}

// ─── Per-row component ────────────────────────────────────────────────────────

function FileRowDisplay({ row, onRetry }: { row: FileRow; onRetry: (id: string) => void }) {
  const isQueued = row.uploadStatus === 'queued';
  const poll = useStatusPoll(row.evalId, isQueued);
  const result = poll.data;
  const status = result?.status;

  const navigate = useNavigate();

  if (row.uploadStatus === 'error') {
    return (
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-500 truncate max-w-xs">{row.call_id}</p>
          <p className="text-xs text-red-500 mt-0.5">{row.reason ?? 'Error al subir'}</p>
        </div>
        <span className="flex items-center gap-1.5 text-sm font-medium text-red-600 shrink-0">
          <XCircle size={15} /> No subido
        </span>
      </div>
    );
  }

  if (row.uploadStatus === 'skipped') {
    return (
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50">
        <p className="text-sm font-medium text-gray-500 truncate max-w-xs">{row.call_id}</p>
        <span className="flex items-center gap-1.5 text-sm font-medium text-amber-600 shrink-0">
          <AlertCircle size={15} /> Duplicado (omitido)
        </span>
      </div>
    );
  }

  // queued — show processing status
  if (status === 'ready') {
    const score = result?.score_total ?? 0;
    const scoreColor = score >= 80 ? 'text-green-700' : score >= 60 ? 'text-amber-600' : 'text-red-600';
    const conflicto = result?.nivel_conflicto;

    return (
      <div
        className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-green-50 hover:bg-green-100 transition-colors cursor-pointer group"
        onClick={() => row.evalId && navigate(`/evaluaciones/${row.evalId}`)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-dark truncate max-w-xs group-hover:text-brand-red">{row.call_id}</p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={`text-xs font-bold ${scoreColor}`}>{score.toFixed(1)}%</span>
            {conflicto && conflicto !== 'SIN_DATOS' && (
              <span className="text-xs text-gray-500">Conflicto: {conflicto.charAt(0) + conflicto.slice(1).toLowerCase()}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CheckCircle size={15} /> Listo
          </span>
          <ExternalLink size={13} className="text-gray-400 group-hover:text-brand-red" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-red-50">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700 truncate max-w-xs">{row.call_id}</p>
          <p className="text-xs text-red-500 mt-0.5">Error al procesar — se puede reintentar</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-red-600">
            <XCircle size={15} /> Error
          </span>
          {row.evalId && (
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-100 transition-colors"
              onClick={() => onRetry(row.evalId!)}
            >
              <RefreshCw size={12} /> Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  // processing / idle
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50">
      <p className="text-sm font-medium text-gray-700 truncate max-w-xs">{row.call_id}</p>
      <span className="flex items-center gap-1.5 text-sm font-medium text-blue-600 shrink-0">
        <span className="animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full inline-block" />
        Procesando...
      </span>
    </div>
  );
}

// ─── Progress summary bar ─────────────────────────────────────────────────────

function ProgressSummary({ rows, statuses }: { rows: FileRow[]; statuses: Map<string, ProcessStatus> }) {
  const queued = rows.filter((r) => r.uploadStatus === 'queued');
  const skipped = rows.filter((r) => r.uploadStatus === 'skipped').length;
  const uploadErrors = rows.filter((r) => r.uploadStatus === 'error').length;

  let done = 0, errors = 0, processing = 0;
  for (const r of queued) {
    const s = r.evalId ? (statuses.get(r.evalId) ?? 'processing') : 'processing';
    if (s === 'ready') done++;
    else if (s === 'error') errors++;
    else processing++;
  }

  const total = queued.length;
  const resolved = done + errors;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  const allDone = total > 0 && processing === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-brand-dark">
          {allDone ? '¡Procesamiento completado!' : `Procesando... ${resolved}/${total}`}
        </span>
        <div className="flex gap-3 text-xs">
          {done > 0 && <span className="text-green-700 font-semibold">✓ {done} listas</span>}
          {errors > 0 && <span className="text-red-600 font-semibold">✕ {errors} errores</span>}
          {skipped > 0 && <span className="text-gray-500 font-semibold">— {skipped} omitidas</span>}
          {uploadErrors > 0 && <span className="text-red-500 font-semibold">✕ {uploadErrors} no subidas</span>}
        </div>
      </div>
      {total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${allDone && errors === 0 ? 'bg-green-500' : allDone ? 'bg-amber-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BulkUpload() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [gestorId, setGestorId] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [statusMap, setStatusMap] = useState<Map<string, ProcessStatus>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const { data: gestores } = useQuery({
    queryKey: ['gestores-list'],
    queryFn: () => gestoresApi.list().then((r) => r.data),
  });

  const { data: clientesRes } = useQuery({
    queryKey: ['clientes-list'],
    queryFn: () => clientesApi.list({ isActive: true }).then((r) => r.data),
  });
  const clientes = clientesRes?.data ?? [];

  // No persistence by design: leaving the page and returning always starts
  // fresh at zero. Queued evaluations keep processing on the server regardless.
  const retryMutation = useMutation({
    mutationFn: (id: string) => evaluacionesApi.requeue(id),
    onSuccess: (_, id) => {
      setStatusMap((prev) => { const next = new Map(prev); next.set(id, 'processing'); return next; });
      queryClient.invalidateQueries({ queryKey: ['bulk-status', id] });
    },
  });

  function addFiles(incoming: FileList | File[]) {
    const AUDIO_EXTS = ['.gsm', '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.flac', '.zip'];
    const arr = Array.from(incoming).filter((f) =>
      AUDIO_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !existing.has(f.name))];
    });
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  async function handleUpload() {
    if (!gestorId || !files.length) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const res = await evaluacionesApi.bulkUpload(
        gestorId,
        clienteId || undefined,
        files,
        setUploadProgress,
        controller.signal,
      );

      const newRows: FileRow[] = res.data.results.map((r: BulkUploadResult) => ({
        call_id: r.call_id,
        fileName: r.call_id,
        evalId: r.id,
        uploadStatus: r.status,
        reason: r.reason,
      }));

      setRows(newRows);
    } catch (err: unknown) {
      const isCanceled =
        (err as { code?: string; message?: string })?.code === 'ERR_CANCELED' ||
        (err as { message?: string })?.message?.toLowerCase().includes('canceled');

      if (isCanceled) {
        setUploadError(null);
        return;
      }

      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })
          ?.response?.data?.error ??
        (err as { message?: string })?.message ??
        'Error al subir archivos';
      setUploadError(msg);
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
    }
  }

  function handleCancel() {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    handleStartNew();
  }

  function handleStartNew() {
    setRows([]);
    setFiles([]);
    setStatusMap(new Map());
    setUploadProgress(0);
    setUploadError(null);
  }

  const uploaded = rows.length > 0;

  // All queued evaluations have a resolved status (ready/error) — nothing left processing.
  const queuedRows = rows.filter((r) => r.uploadStatus === 'queued');
  const allProcessed =
    uploaded &&
    queuedRows.every((r) => {
      const s = r.evalId ? statusMap.get(r.evalId) : undefined;
      return s === 'ready' || s === 'error';
    });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-dark mb-2"
        >
          <ArrowLeft size={14} /> Volver al Dashboard
        </button>
        <h1 className="text-2xl font-bold text-brand-dark">Carga Masiva de Llamadas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Subí múltiples audios o un ZIP. Se creará y evaluará una auditoría por cada llamada de forma automática.
        </p>
      </div>

      {!uploaded && (
        <>
          {/* Gestor + Cliente */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-brand-dark">1. Seleccioná gestor y cliente</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Gestor <span className="text-brand-red">*</span>
                </label>
                <select value={gestorId} onChange={(e) => setGestorId(e.target.value)} className="input-field w-full">
                  <option value="">— Seleccioná un gestor —</option>
                  {(gestores as Gestor[] | undefined)?.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}{g.legajo ? ` · Leg. ${g.legajo}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
                <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="input-field w-full">
                  <option value="">— Sin cliente —</option>
                  {(clientes as Cliente[]).map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-brand-dark">2. Seleccioná los archivos</h3>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                isDragging ? 'border-brand-red bg-red-50' : 'border-gray-300 hover:border-brand-red hover:bg-gray-50'
              }`}
            >
              <Upload size={32} className="text-gray-400" />
              <p className="text-sm text-gray-600 text-center">Arrastrá archivos acá o hacé click para seleccionar</p>
              <p className="text-xs text-gray-400">GSM, WAV, MP3 y otros formatos, o ZIP con audios — hasta 200 MB</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".gsm,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.flac,.zip"
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {files.map((f) => (
                  <div key={f.name} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 text-sm">
                    <span className="truncate max-w-xs text-brand-dark">{f.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-gray-400 text-xs">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(f.name); }} className="text-gray-400 hover:text-red-500">
                        <XCircle size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {uploadError && <p className="text-sm text-red-600 font-medium">{uploadError}</p>}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleUpload}
              disabled={!gestorId || files.length === 0 || uploading}
              className="btn-primary flex items-center gap-2 w-full justify-center py-3"
            >
              {uploading ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Subiendo... {uploadProgress}%
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Encolar {files.length > 0 ? `${files.length} archivo${files.length > 1 ? 's' : ''}` : 'archivos'}
                </>
              )}
            </button>

            {(uploading || files.length > 0 || rows.length > 0) && (
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary flex items-center justify-center gap-2 w-full py-3"
              >
                <XCircle size={16} />
                Cancelar
              </button>
            )}
          </div>
        </>
      )}

      {/* Results */}
      {uploaded && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <ProgressSummary rows={rows} statuses={statusMap} />

            <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
              {rows.map((row) => (
                <FileRowWithStatus
                  key={row.call_id}
                  row={row}
                  onStatusChange={(id, s) => setStatusMap((prev) => { const n = new Map(prev); n.set(id, s); return n; })}
                  onRetry={(id) => retryMutation.mutate(id)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => navigate('/')} className="btn-secondary flex-1 flex items-center justify-center gap-2">
              Ver Dashboard <ChevronRight size={14} />
            </button>
            {allProcessed ? (
              <button onClick={handleStartNew} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <Upload size={14} /> Nueva carga masiva
              </button>
            ) : (
              <button onClick={handleCancel} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <XCircle size={14} /> Cancelar carga
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper that propagates status up to parent for ProgressSummary
function FileRowWithStatus({
  row,
  onStatusChange,
  onRetry,
}: {
  row: FileRow;
  onStatusChange: (evalId: string, status: ProcessStatus) => void;
  onRetry: (evalId: string) => void;
}) {
  const isQueued = row.uploadStatus === 'queued';
  const poll = useQuery<StatusResult>({
    queryKey: ['bulk-status', row.evalId],
    queryFn: () => evalApi.status(row.evalId!).then((r) => r.data as StatusResult),
    enabled: isQueued && !!row.evalId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return !s || s === 'processing' ? 3000 : false;
    },
  });

  const status = poll.data?.status;

  useEffect(() => {
    if (row.evalId && status) onStatusChange(row.evalId, status);
  }, [row.evalId, status, onStatusChange]);

  return <FileRowDisplay row={row} onRetry={onRetry} />;
}
