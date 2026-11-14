import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/common/Button';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) { setError('Please enter your email and password.'); return; }
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      navigate(user.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
            <Shield size={24} className="text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-[#f0ede8]">OfferCheck</h1>
          <p className="text-sm text-[#a09890] mt-1">Sign in to your account</p>
        </div>

        {/* Demo credentials box */}
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-xs font-semibold text-amber-400 mb-2">Seed demo credentials</p>
          <div className="space-y-1 text-xs text-[#a09890] font-mono">
            <div>Student: <span className="text-[#f0ede8]">student@demo.offercheck</span> / <span className="text-[#f0ede8]">student123</span></div>
            <div>Admin: <span className="text-[#f0ede8]">admin@demo.offercheck</span> / <span className="text-[#f0ede8]">admin123</span></div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#a09890] mb-1.5">Email address</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none focus:border-amber-500/60 transition-colors"
              placeholder="you@demo.offercheck"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#a09890] mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2.5 pr-10 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none focus:border-amber-500/60 transition-colors"
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPw(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6460] hover:text-[#a09890] transition-colors cursor-pointer">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full justify-center">
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-[#6b6460]">
          No account?{' '}
          <Link to="/signup" className="text-amber-400 hover:text-amber-300 transition-colors">Create one</Link>
        </p>
      </div>
    </div>
  );
}

