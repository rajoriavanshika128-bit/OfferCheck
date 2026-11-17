import { AlertTriangle } from 'lucide-react';

export function DisclaimerBox({ text, compact = false }) {
  const defaultText = 'Risk scores and pattern matches are intelligence indicators based on submitted community reports, not legal determinations. Reported information has not been independently verified. Do not submit sensitive passwords or confidential credentials.';
  return (
    <div className={`flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 ${compact ? 'px-4 py-3' : 'px-5 py-4'}`}>
      <AlertTriangle size={compact ? 14 : 16} className="text-amber-500 shrink-0 mt-0.5" />
      <p className={`text-amber-200/80 ${compact ? 'text-xs' : 'text-sm'} leading-relaxed`}>
        {text || defaultText}
      </p>
    </div>
  );
}

