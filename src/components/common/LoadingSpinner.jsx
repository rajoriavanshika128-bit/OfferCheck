export function LoadingSpinner({ size = 'md', fullScreen = false }) {
  const sizes = { sm: 'w-4 h-4 border-2', md: 'w-8 h-8 border-2', lg: 'w-12 h-12 border-[3px]' };
  const spinner = (
    <span className={`inline-block rounded-full border-[#3a3a3a] border-t-amber-500 animate-spin ${sizes[size] || sizes.md}`} />
  );
  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0f0f0f]">
        {spinner}
      </div>
    );
  }
  return spinner;
}

