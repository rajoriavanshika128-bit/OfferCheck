import { Link } from 'react-router-dom';
import { Shield, Search, BarChart3, Network, FileText, Zap, Eye } from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { NODE_COLORS } from '../services/graphService';

// Animated decorative SVG trust graph for hero (purely illustrative)
function HeroGraph() {
  const nodes = [
    { x: 200, y: 100, type: 'upi', r: 14 },
    { x: 100, y: 220, type: 'phone', r: 12 },
    { x: 320, y: 200, type: 'report', r: 16 },
    { x: 450, y: 100, type: 'email', r: 12 },
    { x: 400, y: 260, type: 'report', r: 14 },
    { x: 550, y: 200, type: 'domain', r: 11 },
    { x: 260, y: 310, type: 'report', r: 13 },
  ];
  const edges = [[0,2],[0,4],[1,2],[1,6],[2,4],[3,4],[3,5],[4,5],[4,6]];
  return (
    <svg viewBox="0 0 650 380" className="w-full max-w-xl mx-auto opacity-80" aria-hidden="true">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {edges.map(([a, b], i) => (
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="#3a3a3a" strokeWidth="1.5" />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r}
          fill={NODE_COLORS[n.type] || '#888'} opacity={0.9}
          filter={n.type === 'upi' || n.type === 'report' ? 'url(#glow)' : undefined} />
      ))}
    </svg>
  );
}

const STEPS = [
  { n: '01', title: 'Submit Offer Details', desc: 'Enter the recruiter\'s contact info, UPI ID, company domain, and paste the offer message.' },
  { n: '02', title: 'Entity Resolution & Analysis', desc: 'OfferCheck cross-references identifiers against a database of reported fraud patterns and shared signals.' },
  { n: '03', title: 'See Risk Assessment', desc: 'Get a transparent risk score with individual factor breakdowns, evidence, and confidence levels.' },
];

const FEATURES = [
  { icon: Network, title: 'Trust Graph', desc: 'Visualise connections between reports, identifiers and fraud clusters with multi-hop exploration.' },
  { icon: Search, title: 'Entity Resolution', desc: 'Shared UPI IDs, phones, emails and domains are cross-referenced across all submitted reports.' },
  { icon: BarChart3, title: 'Risk Scoring', desc: 'Each offer gets a transparent score with individual factor weights and supporting evidence.' },
  { icon: FileText, title: 'Report Database', desc: 'Browse and search 35+ detailed reports with full risk factor breakdowns and cluster membership.' },
  { icon: Zap, title: 'Identifier Matching', desc: 'Real-time matching against 70+ known fraud identifiers spanning UPIs, phones, emails and domains.' },
  { icon: Eye, title: 'Transparent Evidence', desc: 'Every risk signal shows its evidence, confidence level, and plain-language explanation.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-[#f0ede8]">
      <Navbar />
      {/* Navbar spacer */}
      <div className="h-14" />

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-medium mb-6">
          <Shield size={12} /> FRAUD INTELLIGENCE PLATFORM
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#f0ede8] leading-tight mb-6">
          That internship offer<br />
          <span className="text-gradient-amber">might be hiding something.</span>
        </h1>
        <p className="text-lg text-[#a09890] max-w-2xl mx-auto mb-8 leading-relaxed">
          OfferCheck cross-references offer details against a database of reported fraud signals — shared UPIs, phone numbers, emails and domains — to surface suspicious patterns before you act.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16">
          <Link to="/check"
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold px-6 py-3 rounded-lg transition-colors text-sm">
            <Search size={16} /> Check an Offer
          </Link>
          <Link to="/reports"
            className="inline-flex items-center gap-2 border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 px-6 py-3 rounded-lg transition-colors text-sm">
            Explore Reports
          </Link>
        </div>
        <HeroGraph />
      </section>

      {/* Stats bar */}
      <div className="border-y border-[#2f2f2f] bg-[#161616]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[['35', 'Reports'], ['70+', 'Identifiers'], ['7', 'Fraud Clusters'], ['Real-time', 'Analysis']].map(([v, l]) => (
            <div key={l}>
              <p className="text-2xl font-bold text-amber-400">{v}</p>
              <p className="text-sm text-[#6b6460] mt-1">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-2xl font-bold text-center text-[#f0ede8] mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map(s => (
            <div key={s.n} className="relative pl-14">
              <div className="absolute left-0 top-0 w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 text-sm font-bold">
                {s.n}
              </div>
              <h3 className="font-semibold text-[#f0ede8] mb-2">{s.title}</h3>
              <p className="text-sm text-[#a09890] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Key Features */}
      <section className="bg-[#161616] border-y border-[#2f2f2f]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="text-2xl font-bold text-center text-[#f0ede8] mb-12">Key Features</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-xl border border-[#2f2f2f] bg-[#1c1c1c] p-5">
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center mb-3">
                  <f.icon size={18} className="text-amber-400" />
                </div>
                <h3 className="font-semibold text-[#f0ede8] mb-1.5">{f.title}</h3>
                <p className="text-sm text-[#a09890] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why OfferCheck */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-2xl">
          <div className="w-1 h-10 bg-amber-500 rounded mb-6" />
          <h2 className="text-2xl font-bold text-[#f0ede8] mb-6">Why OfferCheck?</h2>
          <div className="space-y-4 text-[#a09890] leading-relaxed">
            <p><span className="text-[#f0ede8] font-medium">Not just pattern matching.</span> OfferCheck builds a graph of fraud infrastructure — when the same UPI appears across three companies, that's not coincidence; it's evidence of a coordinated operation.</p>
            <p><span className="text-[#f0ede8] font-medium">Network analysis.</span> Individual reports gain meaning when seen together. Clusters reveal the full scope of fraud rings that isolated reports miss.</p>
            <p><span className="text-[#f0ede8] font-medium">Student-first.</span> Built for the thousands of job and internship seekers who receive suspicious offers every year — giving them the same investigative tools that fraud researchers use.</p>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <DisclaimerBox />
      </section>

      {/* Footer */}
      <footer className="border-t border-[#2f2f2f] bg-[#161616]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-amber-400" />
            <span className="text-sm font-medium text-[#f0ede8]">OfferCheck</span>
          </div>
          <p className="text-xs text-[#6b6460]">Demo project — all data is fictional and illustrative only.</p>
        </div>
      </footer>
    </div>
  );
}

