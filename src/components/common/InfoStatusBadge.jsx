const STATUS_STYLES = {
  Verified:   'bg-green-500/15 text-green-400 border-green-500/30',
  Reported:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Inferred:   'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

export function InfoStatusBadge({ informationStatus }) {
  if (!informationStatus) return null;
  const { isVerified, isInferred } = informationStatus;
  const label = isVerified ? 'Verified' : isInferred ? 'Inferred' : 'Reported';
  const style = STATUS_STYLES[label] || STATUS_STYLES.Reported;
  const tooltips = {
    Verified: 'An admin has reviewed and confirmed this information.',
    Reported: 'This information was submitted by a user and has not yet been verified.',
    Inferred: 'This information was inferred by pattern matching and has not been directly reported.',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${style}`}
      title={tooltips[label]}
    >
      {label}
    </span>
  );
}

