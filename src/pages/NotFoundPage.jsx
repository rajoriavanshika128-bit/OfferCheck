import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
      <Shield size={48} className="text-[#2f2f2f] mb-6" />
      <p className="text-8xl font-bold text-[#232323] mb-4">404</p>
      <h1 className="text-2xl font-semibold text-[#f0ede8] mb-3">Page not found</h1>
      <p className="text-[#a09890] mb-8 max-w-sm">The page you're looking for doesn't exist or has been moved.</p>
      <Link to="/" className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm">
        Go home
      </Link>
    </div>
  );
}

