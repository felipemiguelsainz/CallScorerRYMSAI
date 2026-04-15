import { useState } from 'react';
import { Edit2, Save, X } from 'lucide-react';
import { useUpdateEvaluacion } from '../hooks/useEvaluation';
import DOMPurify from 'dompurify';

interface Props {
  evaluacionId: string;
  transcript: string | null;
}

export default function TranscriptViewer({ evaluacionId, transcript }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(transcript ?? '');
  const { mutate, isPending } = useUpdateEvaluacion(evaluacionId);

  function handleSave() {
    mutate(
      { transcript: text },
      {
        onSuccess: () => setEditing(false),
      },
    );
  }

  if (!transcript) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center bg-gray-50 rounded-lg">
        Aún no hay transcripción. Sube un audio para generarla.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-brand-dark">Transcripción</h4>
        {!editing ? (
          <button
            onClick={() => {
              setText(transcript);
              setEditing(true);
            }}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-red"
          >
            <Edit2 size={12} /> Editar
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <X size={12} /> Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex items-center gap-1 text-xs text-brand-red hover:text-red-700 font-medium"
            >
              <Save size={12} /> Guardar
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="w-full text-sm border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-brand-red"
        />
      ) : (
        <div className="text-sm bg-gray-50 rounded-lg p-3 max-h-72 overflow-y-auto space-y-2">
          {renderTranscriptLines(transcript)}
        </div>
      )}
    </div>
  );
}

function renderTranscriptLines(transcript: string) {
  const safe = DOMPurify.sanitize(transcript, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  const lines = safe
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return <p className="text-gray-500">Sin contenido.</p>;
  }

  return lines.map((line, index) => {
    const speakerMatch = line.match(/^(GESTOR|DEUDOR):\s*(.*)$/i);
    if (!speakerMatch) {
      return (
        <p key={`${index}-${line}`} className="text-gray-700 leading-relaxed">
          {line}
        </p>
      );
    }

    const speaker = speakerMatch[1].toUpperCase();
    const content = speakerMatch[2];
    const isGestor = speaker === 'GESTOR';

    return (
      <div
        key={`${index}-${speaker}-${content}`}
        className={`rounded-lg border px-3 py-2 ${
          isGestor
            ? 'bg-red-50 border-red-200 text-red-900'
            : 'bg-blue-50 border-blue-200 text-blue-900'
        }`}
      >
        <p className="text-[11px] font-bold tracking-wide mb-0.5">{speaker}</p>
        <p className="leading-relaxed">{content}</p>
      </div>
    );
  });
}
