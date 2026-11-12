import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Values arriving here are already masked for student users by the API layer
// (e.g. "98765XXXXX"). Admins receive the full value. The reveal toggle exists
// only as an explicit acknowledgement gesture for non-admin users — the visual
// change is the icon state, not unmasking (the API has already masked the value).
export function MaskedValue({ value }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [acknowledged, setAcknowledged] = useState(false);

  if (!value) return <span className="text-[#6b6460]">—</span>;

  // Admins receive the full value from the API; display it directly.
  if (isAdmin) return <span className="font-mono text-sm text-[#f0ede8]">{value}</span>;

  // Students receive a pre-masked value. The toggle lets users explicitly
  // acknowledge they are viewing illustrative masked data.
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-sm text-[#f0ede8]">{value}</span>
      <button
        onClick={() => setAcknowledged(a => !a)}
        className="text-[#6b6460] hover:text-amber-400 transition-colors cursor-pointer"
        title={acknowledged ? 'Illustrative masked data' : 'Illustrative data — values are masked'}
      >
        {acknowledged ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </span>
  );
}
