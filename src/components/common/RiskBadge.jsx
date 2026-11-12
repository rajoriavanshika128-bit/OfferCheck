export function RiskBadge({ score, category, showScore = true, size = 'md' }) {
  const styles = {
    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
    high:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
    medium:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    low:      'bg-green-500/15 text-green-400 border-green-500/30',
  };
  const dots = {
    critical: 'bg-red-400',
    high:     'bg-orange-400',
    medium:   'bg-yellow-400',
    low:      'bg-green-400',
  };
  const sz = size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';
  const cat = category || 'low';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md font-medium border ${styles[cat] || styles.low} ${sz}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dots[cat] || dots.low}`} />
      {showScore && score != null && `${score} · `}{cat.toUpperCase()}
    </span>
  );
}

