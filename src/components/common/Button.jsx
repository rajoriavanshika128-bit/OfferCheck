export function Button({ variant = 'primary', size = 'md', loading = false, disabled = false, children, className = '', ...props }) {
  const variants = {
    primary:  'bg-amber-500 hover:bg-amber-600 text-black font-semibold',
    secondary:'border border-amber-500 text-amber-500 hover:bg-amber-500/10',
    ghost:    'text-[#a09890] hover:text-[#f0ede8] hover:bg-[#232323]',
    danger:   'bg-red-500 hover:bg-red-600 text-white font-semibold',
    outline:  'border border-[#3a3a3a] text-[#a09890] hover:border-[#4a4a4a] hover:text-[#f0ede8]',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 rounded-lg transition-all duration-150 cursor-pointer
        ${variants[variant] || variants.primary} ${sizes[size] || sizes.md}
        disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      {children}
    </button>
  );
}

