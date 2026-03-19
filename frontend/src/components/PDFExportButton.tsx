import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { evaluacionesApi } from '../services/api.service';

interface Props {
  evaluacionId: string;
  callId: string;
}

export default function PDFExportButton({ evaluacionId, callId }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const res = await evaluacionesApi.exportPdf(evaluacionId);
      const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `evaluacion-${callId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exportando PDF', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="btn-secondary flex items-center gap-2"
    >
      {loading ? (
        <span className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
      ) : (
        <FileDown size={16} />
      )}
      Exportar PDF
    </button>
  );
}
