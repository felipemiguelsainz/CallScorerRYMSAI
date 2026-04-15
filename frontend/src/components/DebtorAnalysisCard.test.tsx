/// <reference types="vitest" />
import { render, screen } from '@testing-library/react';
import DebtorAnalysisCard from './DebtorAnalysisCard';
import type { DebtorAnalysis } from '../services/api.service';

describe('DebtorAnalysisCard', () => {
  it('sanitizes dangerous text content', () => {
    const analysis: DebtorAnalysis = {
      id: '1',
      evaluationId: '2',
      justificacion_tipo: 'OTRA',
      justificacion_detalle: '<script>alert(1)</script>Detalle limpio',
      promesa_de_pago: false,
      fecha_promesa: null,
      monto_prometido: null,
      nivel_conflicto: 'MEDIO',
      resumen_situacion: '<img src=x onerror=alert(1)>Resumen seguro',
      ai_raw_response: null,
      createdAt: new Date().toISOString(),
    };

    render(<DebtorAnalysisCard analysis={analysis} />);

    expect(screen.getByText('Detalle limpio')).toBeInTheDocument();
    expect(screen.getByText('Resumen seguro')).toBeInTheDocument();
    expect(screen.queryByText(/alert\(1\)/)).not.toBeInTheDocument();
  });
});
