import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Music2, Search, X } from 'lucide-react';
import { evaluacionesApi, gestoresApi, Gestor } from '../services/api.service';

export default function NewEvaluation() {
  const navigate = useNavigate();
  const [gestorId, setGestorId] = useState('');
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: gestores = [] } = useQuery({
    queryKey: ['gestores-select', 'GESTOR'],
    queryFn: () => gestoresApi.list({ role: 'GESTOR' }).then((r) => r.data),
  });

  const filteredGestores = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return gestores;
    return gestores.filter((g) => g.name.toLowerCase().includes(q));
  }, [gestores, query]);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    accept: { 'audio/mpeg': ['.mp3'] },
    maxSize: 25 * 1024 * 1024,
    multiple: false,
    onDropAccepted: (accepted) => {
      setFile(accepted[0] ?? null);
      setError('');
    },
    onDropRejected: () => {
      setError('Archivo inv�lido. Solo MP3 de hasta 25MB.');
    },
  });

  async function handleSubmit() {
    setError('');
    if (!gestorId) {
      setError('Selecciona un gestor.');
      return;
    }
    if (!file) {
      setError('Debes adjuntar un archivo MP3.');
      return;
    }

    setSubmitting(true);
    try {
      const createRes = await evaluacionesApi.create({ gestorId });
      const evaluationId = createRes.data.id;

      await evaluacionesApi.uploadAudio(evaluationId, file, (progress) =>
        setUploadProgress(progress),
      );
      navigate(`/evaluaciones/${evaluationId}`);
    } catch {
      setError('No se pudo iniciar la evaluaci�n. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-6">Nueva Evaluaci�n</h1>

      <div className="card space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Gestor *</label>
          <div className="relative mb-2">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-9"
              placeholder="Buscar gestor..."
            />
          </div>
          <select value={gestorId} onChange={(e) => setGestorId(e.target.value)} className="input">
            <option value="">Seleccionar gestor...</option>
            {filteredGestores.map((g: Gestor) => (
              <option key={g.id} value={g.id}>
                {g.name} {g.legajo ? `(${g.legajo})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Archivo de llamada *
          </label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
              isDragActive
                ? 'border-blue-500 bg-blue-50'
                : file
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 bg-white'
            }`}
          >
            <input {...getInputProps()} />
            <Music2 className="mx-auto mb-3 text-gray-500" size={30} />
            {!file && (
              <>
                <p className="font-medium text-gray-700">Arrastra tu archivo MP3 aca</p>
                <p className="text-sm text-gray-500">o haz click para seleccionar (maximo 25MB)</p>
              </>
            )}
            {file && (
              <div className="space-y-2">
                <p className="text-green-700 font-medium">
                  {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                </p>
                <button
                  type="button"
                  className="text-sm text-gray-600 hover:text-gray-800 inline-flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setUploadProgress(0);
                  }}
                >
                  <X size={14} /> quitar
                </button>
              </div>
            )}
          </div>
          {fileRejections.length > 0 && (
            <p className="text-sm text-red-600 mt-2">Archivo rechazado: revisa formato y tama�o.</p>
          )}
        </div>

        {submitting && (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-brand-red h-2 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">Subiendo... {uploadProgress}%</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary">
          {submitting ? 'Iniciando...' : 'Iniciar Evaluacion'}
        </button>
      </div>
    </div>
  );
}
