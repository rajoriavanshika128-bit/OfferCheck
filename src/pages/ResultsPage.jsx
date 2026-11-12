import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertCircle, ShieldAlert, ShieldCheck, Shield, Info, ExternalLink } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { MaskedValue } from '../components/common/MaskedValue';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

const RECOMMENDED_ACTIONS = {
  critical: [
    'Do NOT pay any fee, deposit, or registration amount.',
    'Block the recruiter\'s contact immediately.',
    'Report this offer to your college placement cell.',
    'File a complaint at cybercrime.gov.in if you have already paid.',
    'Warn peers by sharing the identifier details.',
  ],
  high: [
    'Do not pay any amount until independently verifying the company.',
    'Search for the company on MCA21 (mca.gov.in) to check registration.',
    'Call the company\'s publicly listed number — not the number in the offer.',
    'Ask for an official offer letter on company letterhead with GST details.',
  ],
  medium: [
    'Verify the company\'s registration independently before proceeding.',
    'Do not pay any fee — legitimate employers do not charge candidates.',
    'Cross-check the recruiter\'s email domain against the company website.',
    'Ask a trusted person to review the offer before responding.',
  ],
  low: [
    'Exercise standard caution when evaluating any offer.',
    'Never pay any fee regardless of how legitimate an offer appears.',
    'Verify the company exists via LinkedIn or official registrar sites.',
  ],
};

function ScoreRing({ score, category }) {
  const COLOR = { critical:'#ef4444', high:'#f97316', medium:'#eab308', low:'#22c55e' };
  const color = COLOR[category] || '#a09890';
  const r = 52, circ = 2 * Math.PI * r;
  const pct = score / 100;
  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#2f2f2f" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[#f0ede8]">{score}</span>
        <span className="text-xs text-[#6b6460]">/ 100</span>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const { checkId } = useParams();
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('offercheck_results') || '{}');
      const r = stored[checkId];
      if (r) setResult(r);
      else setErr('Check not found.');
    } catch {
      setErr('Unable to load results.');
    }
  }, [checkId]);

  if (err) return (
    <PageLayout>
      <div className="max-w-xl mx-auto py-20 text-center">
        <AlertCircle size={48} className="text-[#6b6460] mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-[#f0ede8] mb-2">Results not found</h1>
        <p className="text-sm text-[#a09890] mb-6">The check ID was not found in this session. Results are stored per-session only.</p>
        <Link to="/check" className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors">
          Run a new check
        </Link>
      </div>
    </PageLayout>
  );

  if (!result) return (
    <PageLayout>
      <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
    </PageLayout>
  );

  const { riskScore, riskCategory, riskFactors, summary, disclaimer, connectedReports, sharedIdentifiers, formData } = result;
  const ScoreIcon = riskCategory === 'critical' ? ShieldAlert : riskCategory === 'high' ? ShieldAlert : riskCategory === 'medium' ? Shield : ShieldCheck;
  const scoreIconColor = { critical:'text-red-400', high:'text-orange-400', medium:'text-yellow-400', low:'text-green-400' };

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Score Hero */}
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-8 text-center">
          <div className="flex justify-center mb-2">
            <ScoreIcon size={28} className={scoreIconColor[riskCategory]} />
          </div>
          <h1 className="text-lg font-semibold text-[#f0ede8] mb-6">
            {formData.companyName || 'Offer'} — Risk Assessment
          </h1>
          <ScoreRing score={riskScore} category={riskCategory} />
          <div className="mt-4">
            <RiskBadge score={riskScore} category={riskCategory} size="lg" />
          </div>
          <p className="mt-4 text-sm text-[#a09890] max-w-lg mx-auto leading-relaxed">{summary}</p>
        </div>

        {/* Risk Factors */}
        {riskFactors?.length > 0 ? (
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
            <h2 className="font-semibold text-[#f0ede8] mb-4">Risk Factors ({riskFactors.length})</h2>
            <div className="space-y-4">
              {riskFactors.map((f, i) => (
                <div key={i} className="border border-[#2f2f2f] rounded-lg p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-sm font-medium text-[#f0ede8]">{f.description}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium
                        ${f.confidence === 'high' ? 'bg-green-500/10 text-green-400'
                        : f.confidence === 'medium' ? 'bg-yellow-500/10 text-yellow-400'
                        : 'bg-[#232323] text-[#6b6460]'}`}>
                        {f.confidence}
                      </span>
                      <span className="text-xs text-amber-400 font-semibold">+{f.weight}pts</span>
                    </div>
                  </div>
                  <div className="w-full bg-[#2f2f2f] rounded-full h-1.5 mb-3">
                    <div className="bg-amber-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.min((f.weight / 35) * 100, 100)}%` }} />
                  </div>
                  <p className="text-xs text-[#a09890] mb-2 leading-relaxed">{f.explanation}</p>
                  <div className="bg-[#0f0f0f] border border-[#1c1c1c] rounded px-3 py-2 text-xs text-[#6b6460] font-mono break-all">
                    {f.evidence}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6 text-center">
            <Info size={28} className="text-[#6b6460] mx-auto mb-2" />
            <p className="text-sm text-[#a09890]">No specific risk factors matched. This does not confirm the offer is safe.</p>
          </div>
        )}

        {/* Shared Identifiers */}
        {sharedIdentifiers?.length > 0 && (
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
            <h2 className="font-semibold text-[#f0ede8] mb-4">Matched Identifiers</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-[#6b6460] text-left border-b border-[#2f2f2f]">
                  <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4">Value</th>
                  <th className="pb-2 pr-4">Seen In</th><th className="pb-2">Risk</th>
                </tr></thead>
                <tbody className="divide-y divide-[#1c1c1c]">
                  {sharedIdentifiers.map(id => (
                    <tr key={id.id}>
                      <td className="py-2 pr-4 text-xs uppercase font-mono text-[#6b6460]">{id.type}</td>
                      <td className="py-2 pr-4"><MaskedValue value={id.value} type={id.type} /></td>
                      <td className="py-2 pr-4 text-[#a09890]">{id.sharedCount} report{id.sharedCount !== 1 ? 's' : ''}</td>
                      <td className="py-2"><RiskBadge score={id.riskScore} category={id.riskScore >= 80 ? 'critical' : id.riskScore >= 60 ? 'high' : id.riskScore >= 35 ? 'medium' : 'low'} size="sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Connected Reports */}
        {connectedReports?.length > 0 && (
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
            <h2 className="font-semibold text-[#f0ede8] mb-4">Connected Reports ({connectedReports.length})</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {connectedReports.slice(0, 6).map(cr => (
                <Link key={cr.id} to={`/reports/${cr.id}`}
                  className="flex items-center justify-between rounded-lg border border-[#2f2f2f] bg-[#1c1c1c] px-4 py-3 hover:border-[#3a3a3a] transition-colors">
                  <div>
                    <p className="text-sm text-[#f0ede8] font-medium">{cr.companyName}</p>
                    <p className="text-xs text-[#6b6460] mt-0.5">{cr.id} · {cr.status}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RiskBadge score={cr.riskScore} category={cr.riskCategory} showScore={false} size="sm" />
                    <ExternalLink size={12} className="text-[#6b6460]" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recommended Actions */}
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">Recommended Actions</h2>
          <ol className="space-y-2">
            {(RECOMMENDED_ACTIONS[riskCategory] || RECOMMENDED_ACTIONS.low).map((action, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-[#a09890]">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs flex items-center justify-center font-semibold mt-0.5">
                  {i + 1}
                </span>
                {action}
              </li>
            ))}
          </ol>
        </div>

        <DisclaimerBox text={disclaimer} />

        <div className="flex gap-3">
          <Link to="/check" className="inline-flex items-center gap-2 border border-[#3a3a3a] text-[#a09890] hover:text-[#f0ede8] hover:border-[#4a4a4a] px-4 py-2 rounded-lg text-sm transition-colors">
            Check another offer
          </Link>
          <Link to="/reports" className="inline-flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition-colors px-4 py-2">
            Browse all reports →
          </Link>
        </div>
      </div>
    </PageLayout>
  );
}

