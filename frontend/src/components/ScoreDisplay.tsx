interface Props {
  score: number | string | null | undefined;
  label?: string;
  size?: 'sm' | 'lg';
}

export default function ScoreDisplay({ score, label, size = 'sm' }: Props) {
  const normalizedScore = toScoreNumber(score);

  const color =
    normalizedScore >= 80 ? 'text-green-600' : normalizedScore >= 60 ? 'text-orange-500' : 'text-red-600';
  const bg =
    normalizedScore >= 80
      ? 'bg-green-50 border-green-200'
      : normalizedScore >= 60
        ? 'bg-orange-50 border-orange-200'
        : 'bg-red-50 border-red-200';

  if (size === 'lg') {
    return (
      <div className={`flex flex-col items-center justify-center rounded-xl border p-6 ${bg}`}>
        <span className={`text-5xl font-bold ${color}`}>{normalizedScore.toFixed(1)}%</span>
        {label && <span className="text-sm text-gray-500 mt-1">{label}</span>}
      </div>
    );
  }

  return (
    <span className={`font-semibold ${color}`}>{normalizedScore.toFixed(1)}%</span>
  );
}

function toScoreNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}
