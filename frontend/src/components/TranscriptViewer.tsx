import { useState, useRef, useEffect } from 'react';
import { Edit2, Save, X } from 'lucide-react';
import { useUpdateEvaluacion } from '../hooks/useEvaluation';
import DOMPurify from 'dompurify';

interface Props {
  evaluacionId: string;
  transcript: string | null;
  highlightCitation?: string | null;
}

export default function TranscriptViewer({ evaluacionId, transcript, highlightCitation }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(transcript ?? '');
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { mutate, isPending } = useUpdateEvaluacion(evaluacionId);

  useEffect(() => {
    if (!highlightCitation || !transcript || !containerRef.current) return;

    const lines = transcript
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const citMatch = highlightCitation.match(/^(GESTOR|DEUDOR):\s*(.+)/i);
    const citationContent = (citMatch ? citMatch[2] : highlightCitation)
      .replace(/\.{2,}$/, '')
      .toLowerCase()
      .trim();
    const citationSpeaker = citMatch ? citMatch[1].toUpperCase() : null;
    const searchKey = citationContent.slice(0, 35);

    const idx = lines.findIndex((line) => {
      const lm = line.match(/^(GESTOR|DEUDOR):\s*(.+)/i);
      if (!lm) return false;
      if (citationSpeaker && lm[1].toUpperCase() !== citationSpeaker) return false;
      return lm[2].toLowerCase().includes(searchKey);
    });

    if (idx === -1) return;

    setHighlightedIndex(idx);

    const target = lineRefs.current[idx];
    const container = containerRef.current;
    if (target && container) {
      const targetTop = target.offsetTop - container.offsetTop;
      container.scrollTo({ top: targetTop - 16, behavior: 'smooth' });
    }

    const timer = setTimeout(() => setHighlightedIndex(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightCitation, transcript]);

  function handleSave() {
    mutate({ transcript: text }, { onSuccess: () => setEditing(false) });
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h4 className="text-sm font-semibold text-brand-dark">Transcripción</h4>
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" />
              Deudor — izquierda
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-red" />
              Gestor — derecha
            </span>
          </div>
        </div>
        {!editing ? (
          <button
            onClick={() => { setText(transcript); setEditing(true); }}
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
          rows={12}
          className="w-full text-sm border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-brand-red font-mono"
        />
      ) : (
        <div
          ref={containerRef}
          className="bg-gray-50 rounded-xl p-4 max-h-[420px] overflow-y-auto space-y-2"
        >
          {renderChatLines(transcript, highlightedIndex, lineRefs)}
        </div>
      )}
    </div>
  );
}

function renderChatLines(
  transcript: string,
  highlightedIndex: number | null,
  lineRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
) {
  const safe = DOMPurify.sanitize(transcript, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  const lines = safe
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return <p className="text-gray-500 text-sm">Sin contenido.</p>;

  return lines.map((line, index) => {
    const speakerMatch = line.match(/^(GESTOR|DEUDOR):\s*(.*)$/i);
    const isHighlighted = index === highlightedIndex;

    if (!speakerMatch) {
      return (
        <p
          key={`${index}-${line}`}
          ref={(el) => { lineRefs.current[index] = el; }}
          className={`text-xs text-gray-400 text-center italic px-2 rounded ${isHighlighted ? 'transcript-line-highlight' : ''}`}
        >
          {line}
        </p>
      );
    }

    const speaker = speakerMatch[1].toUpperCase();
    const content = speakerMatch[2];
    const isGestor = speaker === 'GESTOR';

    return (
      <div
        key={`${index}-${speaker}-${content.slice(0, 20)}`}
        ref={(el) => { lineRefs.current[index] = el; }}
        className={`flex ${isGestor ? 'justify-end' : 'justify-start'}`}
      >
        <div className={`max-w-[78%] ${isGestor ? 'items-end' : 'items-start'} flex flex-col`}>
          <span className={`text-[10px] font-bold mb-0.5 px-1 ${isGestor ? 'text-right text-red-500' : 'text-left text-blue-500'}`}>
            {isGestor ? 'GESTOR' : 'DEUDOR'}
          </span>
          <div
            className={`rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
              isGestor
                ? 'bg-red-600 text-white rounded-tr-none'
                : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none'
            } ${isHighlighted ? 'transcript-line-highlight' : ''}`}
          >
            {content}
          </div>
        </div>
      </div>
    );
  });
}
