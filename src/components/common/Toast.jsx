import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';

const ICONS = {
  success: <CheckCircle size={16} className="text-green-400 shrink-0" />,
  error:   <AlertCircle size={16} className="text-red-400 shrink-0" />,
  warning: <AlertTriangle size={16} className="text-yellow-400 shrink-0" />,
  info:    <Info size={16} className="text-blue-400 shrink-0" />,
};
const BG = {
  success: 'border-green-500/30 bg-green-500/10',
  error:   'border-red-500/30 bg-red-500/10',
  warning: 'border-yellow-500/30 bg-yellow-500/10',
  info:    'border-blue-500/30 bg-blue-500/10',
};

function ToastItem({ toast }) {
  const { removeToast } = useToast();
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg min-w-72 max-w-sm ${BG[toast.type] || BG.info}`}>
      {ICONS[toast.type] || ICONS.info}
      <p className="flex-1 text-sm text-[#f0ede8]">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-[#6b6460] hover:text-[#f0ede8] transition-colors cursor-pointer shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();
  if (!toasts.length) return null;
  return createPortal(
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>,
    document.body
  );
}

