import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Search, Filter, ChevronLeft, ChevronRight, ExternalLink, AlertCircle } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { InfoStatusBadge } from '../components/common/InfoStatusBadge';
import { MaskedValue } from '../components/common/MaskedValue';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { getReports, getReportById } from '../services/mockApi';
import { useAuth } from '../contexts/AuthContext';

const CATEGORIES = ['critical','high','medium','low'];
const STATUSES = ['pending','verified','investigating','rejected'];
const SORTS = [{v:'riskScore',l:'Risk Score'},{v:'date',l:'Date'}];

function ConfidencePip({ confidence }) {
  const c = { high:'bg-green-400', medium:'bg-yellow-400', low:'bg-[#6b6460]' };
  return <span className={`inline-block w-2 h-2 rounded-full ${c[confidence]||c.low}`} title={`${confidence} confidence`} />;
}

// ─── Report Detail View ──────────────────────────────────────────────────────
function ReportDetail({ reportId }) {
  const { user } = useAuth();
  const role = user?.role || 'student';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    getReportById(reportId, role)
      .then(setData)
      .catch(() => setErr('Report not found.'))
      .finally(() => setLoading(false));
  }, [reportId, role]);

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>;
  if (err) return (
    <div className="max-w-2xl mx-auto py-20 text-center">
      <AlertCircle size={40} className="text-[#6b6460] mx-auto mb-4" />
      <p className="text-[#a09890]">{err}</p>
      <button onClick={() => navigate('/reports')} className="mt-4 text-amber-400 text-sm hover:underline cursor-pointer">← Back to Reports</button>
    </div>
  );
  const r = data;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate('/reports')} className="flex items-center gap-1 text-sm text-[#a09890] hover:text-[#f0ede8] transition-colors cursor-pointer mb-2">
        <ChevronLeft size={16} /> All Reports
      </button>

      {/* Header */}
      <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <RiskBadge score={r.riskScore} category={r.riskCategory} size="lg" />
          <InfoStatusBadge informationStatus={r.informationStatus} />
          <span className={`text-xs px-2 py-1 rounded border font-medium
            ${r.status === 'verified' ? 'border-green-500/30 text-green-400 bg-green-500/10'
            : r.status === 'investigating' ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
            : r.status === 'rejected' ? 'border-red-500/30 text-red-400 bg-red-500/10'
            : 'border-[#3a3a3a] text-[#6b6460]'}`}>
            {r.status}
          </span>
        </div>
        <h1 className="text-xl font-bold text-[#f0ede8] mb-1">{r.title}</h1>
        <p className="text-sm text-[#a09890]">Submitted {r.submittedAt}{r.reviewedAt ? ` · Reviewed ${r.reviewedAt}` : ''}</p>

        <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          {[
            ['Company', r.companyName], ['Recruiter', r.recruiterName],
            ['Phone', r.phone, 'phone'], ['Email', r.email, 'email'],
            ['UPI', r.upiId, 'upi'], ['Domain', r.domain],
            ['Payment Request', r.paymentRequest],
          ].map(([k, v, type]) => v ? (
            <div key={k}>
              <span className="text-[#6b6460]">{k}: </span>
              {type ? <MaskedValue value={v} type={type} /> : <span className="text-[#f0ede8]">{v}</span>}
            </div>
          ) : null)}
        </div>
        {r.offerMessage && (
          <div className="mt-4">
            <p className="text-xs text-[#6b6460] mb-1">Offer message</p>
            <div className="bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-4 py-3 text-sm text-[#a09890] leading-relaxed italic">
              "{r.offerMessage}"
            </div>
          </div>
        )}
      </div>

      {/* Risk Factors */}
      {r.riskFactors?.length > 0 && (
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">Risk Factors</h2>
          <div className="space-y-4">
            {r.riskFactors.map((f, i) => (
              <div key={i} className="border border-[#2f2f2f] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <ConfidencePip confidence={f.confidence} />
                    <span className="text-sm font-medium text-[#f0ede8]">{f.description}</span>
                  </div>
                  <span className="text-xs text-amber-400 font-semibold">+{f.weight} pts</span>
                </div>
                <div className="w-full bg-[#2f2f2f] rounded-full h-1.5 mb-3">
                  <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${Math.min((f.weight / 35) * 100, 100)}%` }} />
                </div>
                <p className="text-xs text-[#a09890] mb-2 leading-relaxed">{f.explanation}</p>
                <div className="bg-[#0f0f0f] rounded px-3 py-2 text-xs text-[#6b6460] font-mono">{f.evidence}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shared Identifiers */}
      {r.identifiers?.length > 0 && (
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">Shared Identifiers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-[#6b6460] text-left border-b border-[#2f2f2f]">
                <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4">Value</th>
                <th className="pb-2 pr-4">Reports</th><th className="pb-2">Risk</th>
              </tr></thead>
              <tbody className="divide-y divide-[#1c1c1c]">
                {r.identifiers.map(id => (
                  <tr key={id.id}>
                    <td className="py-2 pr-4"><span className="text-xs uppercase text-[#6b6460] font-mono">{id.type}</span></td>
                    <td className="py-2 pr-4"><MaskedValue value={id.value} type={id.type} /></td>
                    <td className="py-2 pr-4 text-[#a09890]">{id.reportIds?.length || id.reportCount || '—'}</td>
                    <td className="py-2"><RiskBadge score={id.riskScore} category={id.riskScore >= 80 ? 'critical' : id.riskScore >= 60 ? 'high' : id.riskScore >= 35 ? 'medium' : 'low'} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Connected Reports */}
      {r.connectedReports?.length > 0 && (
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">Connected Reports ({r.connectedReports.length})</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {r.connectedReports.slice(0, 6).map(cr => (
              <Link key={cr.id} to={`/reports/${cr.id}`}
                className="flex items-center justify-between rounded-lg border border-[#2f2f2f] bg-[#1c1c1c] px-4 py-3 hover:border-[#3a3a3a] transition-colors">
                <div>
                  <p className="text-sm text-[#f0ede8] font-medium">{cr.companyName}</p>
                  <p className="text-xs text-[#6b6460] mt-0.5">{cr.id}</p>
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

      <DisclaimerBox compact />
    </div>
  );
}

// ─── Reports List View ───────────────────────────────────────────────────────
export default function ReportsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = user?.role || 'student';

  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('riskScore');
  const [page, setPage] = useState(1);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getReports({ search, riskCategory: category, status, sortBy, page, limit: 10 }, role);
      setReports(res.reports);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } finally {
      setLoading(false);
    }
  }, [search, category, status, sortBy, page, role]);

  useEffect(() => { fetchReports(); }, [fetchReports]);
  useEffect(() => { setPage(1); }, [search, category, status, sortBy]);

  if (id) {
    return (
      <PageLayout>
        <ReportDetail reportId={id} />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#f0ede8]">Reports</h1>
        <p className="text-sm text-[#a09890] mt-1">Browse user-submitted fraud reports and their risk assessments.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6460]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company, recruiter, email…"
            className="w-full bg-[#161616] border border-[#3a3a3a] rounded-lg pl-9 pr-3 py-2 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none focus:border-amber-500/60" />
        </div>
        {[
          { val: category, set: setCategory, opts: CATEGORIES, placeholder: 'Risk Category' },
          { val: status, set: setStatus, opts: STATUSES, placeholder: 'Status' },
        ].map((f, i) => (
          <select key={i} value={f.val} onChange={e => f.set(e.target.value)}
            className="bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-[#a09890] focus:outline-none focus:border-amber-500/60 cursor-pointer">
            <option value="">{f.placeholder}</option>
            {f.opts.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
          </select>
        ))}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-[#a09890] focus:outline-none focus:border-amber-500/60 cursor-pointer">
          {SORTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
      </div>

      <p className="text-xs text-[#6b6460] mb-4">Showing {reports.length} of {total} reports</p>

      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : reports.length === 0 ? (
        <div className="text-center py-20">
          <Filter size={40} className="text-[#2f2f2f] mx-auto mb-4" />
          <p className="text-[#a09890]">No reports match your filters.</p>
          <button onClick={() => { setSearch(''); setCategory(''); setStatus(''); }} className="mt-3 text-amber-400 text-sm hover:underline cursor-pointer">Clear filters</button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[#2f2f2f]">
            <table className="w-full text-sm">
              <thead className="bg-[#161616]">
                <tr className="text-xs text-[#6b6460] text-left border-b border-[#2f2f2f]">
                  {['ID','Company','Recruiter','Risk','Category','Status','Date',''].map(h => (
                    <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1c] bg-[#0f0f0f]">
                {reports.map(r => (
                  <tr key={r.id} className="hover:bg-[#161616] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-[#6b6460]">{r.id}</td>
                    <td className="px-4 py-3 text-[#f0ede8] font-medium max-w-40 truncate">{r.companyName}</td>
                    <td className="px-4 py-3 text-[#a09890] whitespace-nowrap">{r.recruiterName}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[#f0ede8]">{r.riskScore}</span>
                    </td>
                    <td className="px-4 py-3"><RiskBadge score={null} category={r.riskCategory} showScore={false} /></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${r.status === 'verified' ? 'text-green-400' : r.status === 'investigating' ? 'text-blue-400' : r.status === 'rejected' ? 'text-red-400' : 'text-[#6b6460]'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#6b6460] text-xs whitespace-nowrap">{r.submittedAt}</td>
                    <td className="px-4 py-3">
                      <Link to={`/reports/${r.id}`} className="text-amber-400 hover:text-amber-300 text-xs whitespace-nowrap">View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-[#6b6460]">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft size={14} /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}

