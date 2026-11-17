import { Link } from 'react-router-dom';
import {
  Upload, Fingerprint, GitMerge, Network, BarChart3,
  Search, Shield, AlertTriangle, CheckCircle, Info,
  CreditCard, Globe, FileText, Clock
} from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';

// ─── Step data ─────────────────────────────────────────────────────────────────
const STEPS = [
  {
    n: '01',
    icon: Upload,
    title: 'Submit an Offer',
    desc: 'A student or job seeker submits the details of a suspicious internship or job offer — including the recruiter\'s name, phone number, email address, UPI ID, company domain and any offer message received.',
    detail: 'The more identifiers submitted, the richer the analysis. Even a single phone number or UPI ID can reveal connections to previous reports.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    n: '02',
    icon: Fingerprint,
    title: 'Identifier Extraction',
    desc: 'OfferCheck extracts and normalises the submitted identifiers — phone numbers, email addresses, UPI IDs and website domains — into a consistent, comparable format.',
    detail: 'Phone numbers are normalised to include country codes. Domains are stripped of protocols and trailing slashes. This ensures a UPI entered as "pay@upi" matches the same address entered differently.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
  },
  {
    n: '03',
    icon: GitMerge,
    title: 'Entity Resolution',
    desc: 'Each extracted identifier is cross-referenced against the database of previously submitted reports. If the same phone number, email, UPI ID or domain has appeared in other reports, those connections are recorded.',
    detail: 'A recruiter using the same UPI across three companies is a signal worth examining. Entity resolution surfaces these shared identifiers so that isolated reports can be understood in context.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
  {
    n: '04',
    icon: Network,
    title: 'Trust Graph',
    desc: 'Reports and identifiers that share connections are linked into a graph. This makes it possible to see fraud clusters — groups of reports connected through common phone numbers, UPIs, emails or domains.',
    detail: 'The Trust Graph lets you explore connections visually. You can click on any report or identifier to see what else it connects to, and ask OfferCheck to explain why two reports appear to be linked.',
    color: 'text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
  },
  {
    n: '05',
    icon: BarChart3,
    title: 'Risk Analysis',
    desc: 'OfferCheck evaluates the submitted offer against a set of risk indicators and produces a score from 0–100. Each contributing factor is shown individually with its supporting evidence and a plain-language explanation.',
    detail: 'The risk score is a signal, not a verdict. It reflects the strength of available evidence from submitted reports. Recommended next steps are provided to help the user decide how to proceed safely.',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
  },
];

// ─── Risk signal data ──────────────────────────────────────────────────────────
const RISK_SIGNALS = [
  {
    icon: CreditCard,
    title: 'Payment Requests',
    desc: 'Legitimate employers rarely ask candidates to pay fees before joining. Requests for registration fees, security deposits or training payments via UPI or bank transfer are significant warning signals in submitted reports.',
  },
  {
    icon: Fingerprint,
    title: 'Repeated Identifiers',
    desc: 'When the same UPI ID, phone number or email address appears across multiple reports from different companies, this pattern suggests a shared fraud infrastructure rather than a coincidence.',
  },
  {
    icon: Globe,
    title: 'Suspicious Domains and Contact Details',
    desc: 'Domains registered very recently, free-email addresses (Gmail, Yahoo, Outlook) used as official corporate contacts, and domains that differ slightly from well-known companies are examined as potential indicators.',
  },
  {
    icon: FileText,
    title: 'Previous Reports and Moderation Status',
    desc: 'Reports that have been reviewed and verified by moderators carry more evidential weight than pending or newly submitted reports. The status of each linked report is factored into the analysis.',
  },
  {
    icon: CheckCircle,
    title: 'Evidence Quality and Confidence',
    desc: 'Each risk factor carries a confidence level — high, medium or low — based on the quality and quantity of supporting evidence. Factors with weak evidence contribute less to the overall score.',
  },
  {
    icon: Clock,
    title: 'Recency and Frequency',
    desc: 'Identifiers that appear in reports submitted recently, or across a high number of separate reports over a short period, are weighted more heavily than older or infrequent signals.',
  },
];

// ─── Components ────────────────────────────────────────────────────────────────
function StepCard({ step, isLast }) {
  const Icon = step.icon;
  return (
    <div className="relative">
      {/* Connector line between steps on desktop */}
      {!isLast && (
        <div className="hidden lg:block absolute top-8 left-[calc(50%+2.5rem)] right-0 h-px bg-gradient-to-r from-[#3a3a3a] to-transparent z-0" />
      )}

      <div className="relative z-10 flex flex-col sm:flex-row lg:flex-col gap-5 p-5 rounded-xl border border-[#2f2f2f] bg-[#161616] h-full">
        {/* Step number + icon */}
        <div className="flex items-center gap-3 shrink-0">
          <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${step.bg}`}>
            <Icon size={18} className={step.color} />
          </div>
          <span className="text-2xl font-bold text-[#2f2f2f] font-mono lg:hidden">{step.n}</span>
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono font-semibold text-[#4a4a4a] hidden lg:block">{step.n}</span>
            <h3 className="font-semibold text-[#f0ede8] text-sm">{step.title}</h3>
          </div>
          <p className="text-sm text-[#a09890] leading-relaxed mb-3">{step.desc}</p>
          <p className="text-xs text-[#6b6460] leading-relaxed italic border-l-2 border-[#2f2f2f] pl-3">{step.detail}</p>
        </div>
      </div>
    </div>
  );
}

function RiskSignalCard({ signal }) {
  const Icon = signal.icon;
  return (
    <div className="flex gap-4 p-4 rounded-xl border border-[#2f2f2f] bg-[#0f0f0f]">
      <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={16} className="text-amber-400" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-[#f0ede8] mb-1">{signal.title}</h3>
        <p className="text-sm text-[#a09890] leading-relaxed">{signal.desc}</p>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function HowItWorksPage() {
  return (
    <PageLayout>
      <div className="max-w-5xl mx-auto space-y-20 pb-8">

        {/* Page header */}
        <div className="text-center pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-medium mb-5">
            <Shield size={12} /> HOW OFFERCHECK WORKS
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#f0ede8] tracking-tight mb-4">
            From offer submission to risk assessment
          </h1>
          <p className="text-[#a09890] max-w-2xl mx-auto leading-relaxed">
            OfferCheck analyses suspicious job and internship offers by cross-referencing submitted details against a database of reported fraud signals. Here is how each step works.
          </p>
        </div>

        {/* ── SECTION 1: The 5-step workflow ─────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-1 h-7 bg-amber-500 rounded" />
            <h2 className="text-xl font-bold text-[#f0ede8]">The OfferCheck Workflow</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {STEPS.map((step, i) => (
              <StepCard key={step.n} step={step} isLast={i === STEPS.length - 1} />
            ))}
          </div>
        </section>

        {/* ── SECTION 2: How risk is calculated ──────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-7 bg-amber-500 rounded" />
            <h2 className="text-xl font-bold text-[#f0ede8]">How Risk Is Evaluated</h2>
          </div>
          <p className="text-[#a09890] text-sm leading-relaxed mb-6 max-w-3xl">
            OfferCheck does not use a proprietary algorithm or claim a scientifically validated fraud detection method. Instead, it evaluates a set of observable risk signals drawn from submitted reports. Each signal has a confidence level and supporting evidence shown to you directly.
          </p>

          {/* Important transparency note */}
          <div className="flex gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-5 py-4 mb-8">
            <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-200/80 leading-relaxed">
              <span className="font-semibold text-blue-300">Risk signals are not verdicts.</span> A high risk score means the submitted details share characteristics with previously reported suspicious offers. It does not prove that the offer is fraudulent. Always independently verify any offer before making payments or sharing sensitive personal information.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {RISK_SIGNALS.map(signal => (
              <RiskSignalCard key={signal.title} signal={signal} />
            ))}
          </div>

          {/* Information status explanation */}
          <div className="mt-6 rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h3 className="text-sm font-semibold text-[#f0ede8] mb-4">Information status labels</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: 'Reported', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', desc: 'Submitted by a user. Has not been independently checked. May be inaccurate or incomplete.' },
                { label: 'Inferred', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', desc: 'Derived from patterns in other reports. Not directly submitted. Treat as a possible signal only.' },
                { label: 'Verified', color: 'text-green-400 bg-green-500/10 border-green-500/30', desc: 'Reviewed and confirmed by a moderator. Carries the most evidential weight in risk analysis.' },
              ].map(item => (
                <div key={item.label} className="flex flex-col gap-2">
                  <span className={`inline-flex self-start items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${item.color}`}>
                    {item.label}
                  </span>
                  <p className="text-xs text-[#6b6460] leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SECTION 3: Safety and disclaimer ───────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-1 h-7 bg-amber-500 rounded" />
            <h2 className="text-xl font-bold text-[#f0ede8]">Safety and Important Limitations</h2>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-6 space-y-5">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-amber-300">
                Please read these limitations carefully before acting on any OfferCheck result.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  heading: 'Shared identifiers do not independently prove fraud',
                  body: 'A phone number, email or UPI ID appearing in multiple reports is a signal worth examining — it is not proof of criminal activity. There may be legitimate explanations, including data errors, recycled numbers or misidentification.',
                },
                {
                  heading: 'Reports may be unverified or disputed',
                  body: 'Most reports are submitted by users and have not been independently verified. A report marked "pending" or "reported" reflects one person\'s account. Treat unverified reports as one data point, not as fact.',
                },
                {
                  heading: 'Risk scores are informational, not a guarantee',
                  body: 'A score of 80/100 does not mean an offer is definitely fraudulent. A score of 20/100 does not make an offer safe. The score reflects patterns in available data. Use it as one input alongside your own judgement.',
                },
                {
                  heading: 'Verify independently before taking action',
                  body: 'Before declining or accepting an offer — and especially before making any payment or sharing sensitive documents — independently verify the company through official channels: their registered website, LinkedIn, government business registries or by calling their official published number.',
                },
              ].map(item => (
                <div key={item.heading} className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-semibold text-[#f0ede8]">{item.heading}</h3>
                  <p className="text-sm text-[#a09890] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-amber-500/15 pt-4">
              <p className="text-xs text-amber-200/50 leading-relaxed">
                Risk scores and intelligence signals are indicators, not legal determinations. OfferCheck does not constitute legal advice. Always consult appropriate authorities and verify offers through official registered channels if you believe you have encountered fraud.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────────── */}
        <section className="text-center pb-4">
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] px-6 py-10">
            <h2 className="text-xl font-bold text-[#f0ede8] mb-3">Ready to check an offer?</h2>
            <p className="text-sm text-[#a09890] mb-6 max-w-md mx-auto">
              Submit your offer details and get an instant risk assessment with full transparency into every signal.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/check"
                className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm">
                <Search size={15} /> Check an Offer
              </Link>
              <Link to="/graph"
                className="inline-flex items-center justify-center gap-2 border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 px-6 py-2.5 rounded-lg transition-colors text-sm">
                <Network size={15} /> Explore Trust Graph
              </Link>
            </div>
          </div>
        </section>

      </div>
    </PageLayout>
  );
}

