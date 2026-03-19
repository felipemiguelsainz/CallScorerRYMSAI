import { ScoreValue } from '../services/api.service';

interface Props {
  value: ScoreValue;
}

const config: Record<ScoreValue, { label: string; className: string }> = {
  CUMPLE: { label: 'CUMPLE', className: 'badge-cumple' },
  NO_CUMPLE: { label: 'NO CUMPLE', className: 'badge-no-cumple' },
  NO_APLICA: { label: 'N/A', className: 'badge-no-aplica' },
};

export default function ScoreBadge({ value }: Props) {
  const { label, className } = config[value];
  return <span className={className}>{label}</span>;
}
