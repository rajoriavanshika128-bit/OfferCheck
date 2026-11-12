import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, AlertCircle, Info } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { Button } from '../components/common/Button';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { checkOffer } from '../services/mockApi';
import { useAuth } from '../contexts/AuthContext';

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
      <h2 className="text-sm font-semibold text-[#f0ede8] mb-4 pb-3 border-b border-[#2f2f2f]">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#a09890] mb-1.5">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-[#6b6460]">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

const inputClass = (err) =>
  `w-full bg-[#1c1c1c] border rounded-lg px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none transition-colors
  ${err ? 'border-red-500/60' : 'border-[#3a3a3a] focus:border-amber-500/60'}`;

export default function OfferCheckerPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: '', domain: '',
    recruiterName: '', phone: '', email: '',
    upiId: '', paymentRequest: '', offerMessage: '',
    additionalNotes: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.companyName.trim() && !form.phone.trim() && !form.email.trim()) {
      e.general = 'Please provide at least a company name, recruiter phone, or email address.';
    }
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      const result = await checkOffer({ ...form, _role: user?.role || 'student' });
      navigate(`/results/${result.checkId}`);
    } catch {
      setErrors({ general: 'An error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#f0ede8]">Check an Offer</h1>
          <p className="text-sm text-[#a09890] mt-1">Enter the details of the offer you received. The more information you provide, the more accurate the analysis.</p>
        </div>

        {errors.general && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle size={15} className="shrink-0" /> {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Section title="1 · Company Information">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Company Name" error={errors.companyName}>
                <input value={form.companyName} onChange={set('companyName')} placeholder="e.g. TechBridge Solutions" className={inputClass(errors.companyName)} />
              </Field>
              <Field label="Company Website / Domain" hint="e.g. techbridge-hr.in (without https://)">
                <input value={form.domain} onChange={set('domain')} placeholder="e.g. company.in" className={inputClass()} />
              </Field>
            </div>
          </Section>

          <Section title="2 · Recruiter Information">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Recruiter Name">
                <input value={form.recruiterName} onChange={set('recruiterName')} placeholder="e.g. Rahul Sharma" className={inputClass()} />
              </Field>
              <Field label="Phone Number">
                <input type="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 9876543210" className={inputClass()} />
              </Field>
              <Field label="Email Address" className="sm:col-span-2">
                <input type="email" value={form.email} onChange={set('email')} placeholder="e.g. hr@company.in" className={inputClass()} />
              </Field>
            </div>
          </Section>

          <Section title="3 · Offer Details">
            <div className="space-y-4">
              <Field label="UPI ID" hint="Adding a UPI ID significantly improves detection accuracy.">
                <input value={form.upiId} onChange={set('upiId')} placeholder="e.g. payment@gpay" className={inputClass()} />
              </Field>
              <Field label="Payment Request" hint="Describe any fee or deposit requested.">
                <input value={form.paymentRequest} onChange={set('paymentRequest')} placeholder="e.g. ₹2,500 registration fee" className={inputClass()} />
              </Field>
              <Field label="Offer Message">
                <textarea value={form.offerMessage} onChange={set('offerMessage')} rows={4}
                  placeholder="Paste the offer message or description here…"
                  className={`${inputClass()} resize-none`} />
              </Field>
            </div>
          </Section>

          <Section title="4 · Additional Information">
            <Field label="Additional Notes">
              <textarea value={form.additionalNotes} onChange={set('additionalNotes')} rows={3}
                placeholder="Any other suspicious details…"
                className={`${inputClass()} resize-none`} />
            </Field>
          </Section>

          <div className="flex items-center gap-2 text-xs text-[#6b6460] bg-[#161616] border border-[#2f2f2f] rounded-lg px-4 py-3">
            <Info size={13} className="text-amber-500 shrink-0" />
            Your submission is compared against {'{70+}'} known fraud identifiers. Results are illustrative — not legal determinations.
          </div>

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full justify-center">
            <Search size={16} /> Analyse This Offer
          </Button>
        </form>
      </div>
    </PageLayout>
  );
}

