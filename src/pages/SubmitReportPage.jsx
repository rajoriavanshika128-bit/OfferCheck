import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { Button } from '../components/common/Button';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { submitReport } from '../services/mockApi';

// Label + input wrapper — defined at module scope to maintain stable identity
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
  `w-full bg-[#1c1c1c] border rounded-lg px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none transition-colors ${err ? 'border-red-500/60' : 'border-[#3a3a3a] focus:border-amber-500/60'}`;

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
      <h2 className="text-sm font-semibold text-[#f0ede8] mb-4 pb-3 border-b border-[#2f2f2f]">{title}</h2>
      {children}
    </div>
  );
}

export default function SubmitReportPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: '', domain: '',
    recruiterName: '', phone: '', email: '',
    upiId: '', paymentRequest: '', offerMessage: '',
    additionalNotes: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedId, setSubmittedId] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.companyName.trim()) e.companyName = 'Company name is required.';
    if (!form.recruiterName.trim() && !form.phone.trim() && !form.email.trim()) {
      e.contact = 'Please provide at least one recruiter contact (name, phone, or email).';
    }
    if (!form.offerMessage.trim()) e.offerMessage = 'Please describe the suspicious offer.';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      const result = await submitReport({
        companyName: form.companyName.trim(),
        domain: form.domain.trim() || null,
        recruiterName: form.recruiterName.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        upiId: form.upiId.trim() || null,
        paymentRequest: form.paymentRequest.trim() || null,
        offerMessage: form.offerMessage.trim(),
        additionalNotes: form.additionalNotes.trim() || null,
        // riskScore, riskCategory, title, etc. will be computed by the backend.
        // For now, set illustrative defaults for the demo session.
        title: `Report — ${form.companyName.trim()}`,
        riskScore: 50,
        riskCategory: 'medium',
      });
      setSubmittedId(result.id);
      setSubmitted(true);
    } catch {
      setErrors({ general: 'An error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <PageLayout>
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-[#f0ede8] mb-3">Report Submitted</h1>
          <p className="text-sm text-[#a09890] mb-2">
            Your report <span className="text-[#f0ede8] font-mono">{submittedId}</span> has been recorded and is pending moderator review.
          </p>
          <p className="text-xs text-[#6b6460] mb-8">
            This is a demo — no data is persisted beyond this session. In a live system, our moderation team would review your report within 48 hours.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="primary" onClick={() => navigate('/reports')}>
              View Reports
            </Button>
            <Button variant="ghost" onClick={() => { setSubmitted(false); setForm({ companyName: '', domain: '', recruiterName: '', phone: '', email: '', upiId: '', paymentRequest: '', offerMessage: '', additionalNotes: '' }); }}>
              Submit Another
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText size={20} className="text-amber-400" />
            <h1 className="text-2xl font-bold text-[#f0ede8]">Submit a Report</h1>
          </div>
          <p className="text-sm text-[#a09890]">
            Received a suspicious job or internship offer? Submit the details so other students can be warned. All reports are reviewed by moderators before being listed publicly.
          </p>
        </div>

        <div className="mb-5">
          <DisclaimerBox text="This is a demo platform. Submitted reports are illustrative and not persisted beyond the current session. Do not submit real personal information." />
        </div>

        {errors.general && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle size={15} className="shrink-0" /> {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Section title="1 · Company Information">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Company Name *" error={errors.companyName}>
                <input value={form.companyName} onChange={set('companyName')} placeholder="e.g. TechBridge Solutions" className={inputClass(errors.companyName)} />
              </Field>
              <Field label="Company Website / Domain" hint="e.g. techbridge-hr.in (without https://)">
                <input value={form.domain} onChange={set('domain')} placeholder="e.g. company.in" className={inputClass()} />
              </Field>
            </div>
          </Section>

          <Section title="2 · Recruiter Contact">
            {errors.contact && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <AlertCircle size={13} className="shrink-0" /> {errors.contact}
              </div>
            )}
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
              <Field label="UPI ID" hint="A UPI ID significantly helps identify patterns across reports.">
                <input value={form.upiId} onChange={set('upiId')} placeholder="e.g. payment@gpay" className={inputClass()} />
              </Field>
              <Field label="Payment Requested" hint="Describe any fee or deposit requested.">
                <input value={form.paymentRequest} onChange={set('paymentRequest')} placeholder="e.g. ₹2,500 registration fee" className={inputClass()} />
              </Field>
              <Field label="Offer Message *" hint="Paste or describe the suspicious offer or communication." error={errors.offerMessage}>
                <textarea value={form.offerMessage} onChange={set('offerMessage')} rows={5}
                  placeholder="Describe the offer or paste the message you received…"
                  className={`${inputClass(errors.offerMessage)} resize-none`} />
              </Field>
            </div>
          </Section>

          <Section title="4 · Additional Notes">
            <Field label="Anything else to add?">
              <textarea value={form.additionalNotes} onChange={set('additionalNotes')} rows={3}
                placeholder="Any other details that seem suspicious…"
                className={`${inputClass()} resize-none`} />
            </Field>
          </Section>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button type="submit" variant="primary" size="lg" loading={loading} className="sm:flex-1 justify-center">
              <FileText size={16} /> Submit Report
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => navigate(-1)} className="sm:w-auto justify-center">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </PageLayout>
  );
}

