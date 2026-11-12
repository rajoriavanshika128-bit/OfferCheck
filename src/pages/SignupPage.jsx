import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/common/Button';
import { DisclaimerBox } from '../components/common/DisclaimerBox';

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required.';
    if (!form.email.trim()) e.email = 'Email is required.';
    if (!form.password) e.password = 'Password is required.';
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters.';
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match.';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      await signup(form.name.trim(), form.email.trim(), form.password);
      navigate('/dashboard');
    } catch (err) {
      setErrors({ general: err.message });
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const Field = ({ id, label, type = 'text', value, onChange, error, placeholder, ...rest }) => (
    <div>
      <label className="block text-xs font-medium text-[#a09890] mb-1.5">{label}</label>
      <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder}
        className={`w-full bg-[#161616] border rounded-lg px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none transition-colors
          ${error ? 'border-red-500/60 focus:border-red-500' : 'border-[#3a3a3a] focus:border-amber-500/60'}`}
        {...rest} />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
            <Shield size={24} className="text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-[#f0ede8]">Create account</h1>
          <p className="text-sm text-[#a09890] mt-1">Join OfferCheck to verify offers</p>
        </div>

        <DisclaimerBox compact text="This is a demo — no real account is created. All data is illustrative only." />

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {errors.general && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
              <AlertCircle size={15} className="shrink-0" /> {errors.general}
            </div>
          )}

          <Field id="name" label="Full name" value={form.name} onChange={set('name')} placeholder="Priya Desai" error={errors.name} />
          <Field id="email" label="Email address" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" error={errors.email} autoComplete="email" />

          <div>
            <label className="block text-xs font-medium text-[#a09890] mb-1.5">Password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                placeholder="Min. 6 characters"
                className={`w-full bg-[#161616] border rounded-lg px-3 py-2.5 pr-10 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none transition-colors
                  ${errors.password ? 'border-red-500/60' : 'border-[#3a3a3a] focus:border-amber-500/60'}`} />
              <button type="button" onClick={() => setShowPw(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6460] hover:text-[#a09890] cursor-pointer">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password}</p>}
          </div>

          <Field id="confirm" label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} placeholder="••••••••" error={errors.confirm} />

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full justify-center">
            Create account
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-[#6b6460]">
          Already have an account?{' '}
          <Link to="/login" className="text-amber-400 hover:text-amber-300 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

