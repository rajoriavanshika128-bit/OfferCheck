import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export function MaskedValue({ value, type }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [revealed, setRevealed] = useState(false);

  if (!value) return <span className="text-[#6b6460]">—</span>;
  if (isAdmin) return <span className="font-mono text-sm text-[#f0ede8]">{value}</span>;

  const show = isAdmin || revealed;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-sm text-[#f0ede8]">{value}</span>
      {!isAdmin && (
        <button
          onClick={() => setRevealed(r => !r)}
          className="text-[#6b6460] hover:text-amber-400 transition-colors cursor-pointer"
          title={show ? 'Hide' : 'Reveal (illustrative data)'}
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      )}
    </span>
  );
}

