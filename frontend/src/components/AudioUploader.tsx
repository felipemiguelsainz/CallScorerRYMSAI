import { useRef, useState } from 'react';
import { Upload, FileAudio, X } from 'lucide-react';
import { useUploadAudio } from '../hooks/useEvaluation';

interface Props {
  evaluacionId: string;
  onSuccess?: () => void;
}

export default function AudioUploader({ evaluacionId, onSuccess }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate, isPending, error } = useUploadAudio(evaluacionId);

  function handleFile(file: File) {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (fileExtension !== 'mp3' && file.type !== 'audio/mpeg') {
      setValidationError('Solo se permiten archivos MP3 válidos.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setValidationError('El archivo supera el máximo de 25MB.');
      setSelectedFile(null);
      return;
    }

    setValidationError(null);
    setUploadProgress(0);
    setSelectedFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleUpload() {
    if (!selectedFile) return;
    mutate(
      {
        file: selectedFile,
        onProgress: (progress) => setUploadProgress(progress),
      },
      {
        onSuccess: () => {
          setSelectedFile(null);
          setUploadProgress(0);
          onSuccess?.();
        },
        onError: () => {
          setUploadProgress(0);
        },
      },
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-brand-red bg-red-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <Upload className="mx-auto mb-3 text-gray-400" size={32} />
        <p className="text-sm text-gray-600">
          Arrastra el archivo MP3 aquí o{' '}
          <span className="text-brand-red font-medium">haz click</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">Solo MP3 — max. 25MB</p>
      </div>

      {selectedFile && (
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <FileAudio size={20} className="text-brand-red shrink-0" />
          <span className="text-sm flex-1 truncate">{selectedFile.name}</span>
          <button
            onClick={() => setSelectedFile(null)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {(validationError || error) && (
        <p className="text-sm text-red-600">{validationError ?? (error as Error).message}</p>
      )}

      {isPending && uploadProgress > 0 && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-brand-red transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 text-right">{uploadProgress}%</p>
        </div>
      )}

      {selectedFile && (
        <button
          onClick={handleUpload}
          disabled={isPending}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {isPending ? (
            <>
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              Transcribiendo con Whisper...
            </>
          ) : (
            <>
              <Upload size={16} />
              Subir y Transcribir
            </>
          )}
        </button>
      )}
    </div>
  );
}
