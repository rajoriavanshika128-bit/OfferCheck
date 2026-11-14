import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Search, Filter, ChevronLeft, ChevronRight, ExternalLink,
  AlertCircle, Bookmark, BookmarkCheck, FileText, CheckCircle2
} from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { InfoStatusBadge } from '../components/common/InfoStatusBadge';
import { MaskedValue } from '../components/common/MaskedValue';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { reportService } from '../services/reportService';
import { useAuth } from '../contexts/AuthContext';

const CATEGORIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['pending', 'investigating', 'verified', 'rejected'];
const SORTS = [
  { v: 'submittedAt', l: 'Recently Submitted' },
  { v: 'companyName', l: 'Company Name' },
  { v: 'reviewedAt', l: 'Recently Reviewed' },
];

function ConfidencePip({ confidence }) {
  const c = { high: 'bg-green-400', medium: 'bg-yellow-400', low: 'bg-[#6b6460]' };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${c[confidence] || c.low}`}
      title={`${confidence || 'medium'} confidence`}
    />
  );
}

// ─── Report Detail View ──────────────────────────────────────────────────────
function ReportDetail({ reportId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [relatedReports, setRelatedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [bookmarkFeedback, setBookmarkFeedback] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setErr('');

    Promise.allSettled([
      reportService.getReportById(reportId),
      reportService.getRelatedReports(reportId),
    ]).then(([reportRes, relatedRes]) => {
      if (!isMounted) return;

      if (reportRes.status === 'fulfilled') {
        const report = reportRes.value;
        setData(report);
        setIsSaved(Boolean(report.isSaved));
      } else {
        const error = reportRes.reason;
        if (error?.status === 401 || error?.status === 403) {
          setErr('Access denied: this report is private or pending moderator verification.');
        } else if (error?.status === 404) {
          setErr('Report not found.');
        } else {
          setErr(error?.message || 'Failed to load report.');
        }
      }

      if (relatedRes.status === 'fulfilled') {
        setRelatedReports(relatedRes.value || []);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [reportId]);

  const handleToggleSave = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    setSavingBookmark(true);
    setBookmarkFeedback('');
    try {
      if (isSaved) {
        await reportService.removeSavedReport(reportId);
        setIsSaved(false);
        setBookmarkFeedback('Report removed from bookmarks');
      } else {
        await reportService.saveReport(reportId);
        setIsSaved(true);
        setBookmarkFeedback('Report saved to bookmarks');
      }
      setTimeout(() => setBookmarkFeedback(''), 3000);
    } catch (saveErr) {
      setBookmarkFeedback(saveErr.message || 'Failed to update bookmark');
      setTimeout(() => setBookmarkFeedback(''), 4000);
    } finally {
      setSavingBookmark(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <AlertCircle size={40} className="text-[#6b6460] mx-auto mb-4" />
        <p className="text-[#a09890]">{err}</p>
        <button
          onClick={() => navigate('/reports')}
          className="mt-4 text-amber-400 text-sm hover:underline cursor-pointer"
        >
          ← Back to Reports
        </button>
      </div>
    );
  }

  const r = data;
  if (!r) return null;

  const currentAssessment = r.riskAssessments?.[0] || null;
  const riskScore = r.riskScore ?? currentAssessment?.score ?? 0;
  const riskCategory = r.riskCategory || currentAssessment?.category || (riskScore >= 80 ? 'critical' : riskScore >= 60 ? 'high' : riskScore >= 35 ? 'medium' : 'low');
  const riskFactors = r.riskFactors || currentAssessment?.factors || [];

  const companyDisplayName = r.company?.name || r.companyNameRaw || 'Unspecified Company';
  const recruiterDisplayName = r.recruiter?.name || r.recruiterNameRaw;
  const reportTitle = r.title || `Report — ${companyDisplayName}`;

  const submittedFormatted = r.submittedAt
    ? new Date(r.submittedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  const reviewedFormatted = r.reviewedAt
    ? new Date(r.reviewedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  const identifiersList = (r.identifiers || []).map((item) => {
    const ident = item.identifier || item;
    return {
      id: ident.id || item.id || item.identifierId,
      type: ident.type,
      value: ident.value,
      confidence: ident.confidence || item.confidence || 'medium',
      reportCount: ident.reports?.length || ident.reportCount || '—',
      riskScore: ident.riskScore,
    };
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/reports')}
          className="flex items-center gap-1 text-sm text-[#a09890] hover:text-[#f0ede8] transition-colors cursor-pointer mb-2"
        >
          <ChevronLeft size={16} /> All Reports
        </button>

        {user && (
          <button
            onClick={handleToggleSave}
            disabled={savingBookmark}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer disabled:opacity-60 ${
              isSaved
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 hover:bg-amber-500/20'
                : 'bg-[#1c1c1c] border-[#3a3a3a] text-[#a09890] hover:text-[#f0ede8] hover:border-[#4a4a4a]'
            }`}
          >
            {isSaved ? <BookmarkCheck size={14} className="text-amber-400" /> : <Bookmark size={14} />}
            <span>{isSaved ? 'Saved' : 'Save Report'}</span>
          </button>
        )}
      </div>

      {bookmarkFeedback && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1c1c1c] border border-amber-500/30 text-amber-300 text-xs">
          <CheckCircle2 size={14} />
          <span>{bookmarkFeedback}</span>
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
        <div className="flex flex-wrap items-start gap-3 mb-4">
          <RiskBadge score={riskScore} category={riskCategory} size="lg" />
          {r.informationStatus && <InfoStatusBadge informationStatus={r.informationStatus} />}
          <span
            className={`text-xs px-2.5 py-1 rounded border font-medium ${
              r.status === 'verified'
                ? 'border-green-500/30 text-green-400 bg-green-500/10'
                : r.status === 'investigating'
                ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                : r.status === 'rejected'
                ? 'border-red-500/30 text-red-400 bg-red-500/10'
                : 'border-[#3a3a3a] text-[#a09890] bg-[#222]'
            }`}
          >
            {r.status?.toUpperCase()}
          </span>
        </div>

        <h1 className="text-xl font-bold text-[#f0ede8] mb-1">{reportTitle}</h1>
        <p className="text-sm text-[#a09890]">
          Submitted {submittedFormatted}
          {reviewedFormatted ? ` · Reviewed ${reviewedFormatted}` : ''}
        </p>

        <div className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
          {[
            ['Company', companyDisplayName],
            ['Recruiter', recruiterDisplayName],
            ['Phone', r.phoneRaw || r.phone, 'phone'],
            ['Email', r.emailRaw || r.email, 'email'],
            ['UPI', r.upiRaw || r.upi || r.upiId, 'upi'],
            ['Domain', r.domainRaw || r.domain],
            ['Payment Request', r.paymentRequest],
          ].map(([k, v, type]) =>
            v ? (
              <div key={k} className="flex items-baseline gap-1.5">
                <span className="text-[#6b6460] font-medium">{k}: </span>
                {type ? <MaskedValue value={v} /> : <span className="text-[#f0ede8]">{v}</span>}
              </div>
            ) : null
          )}
        </div>

        {r.offerMessage && (
          <div className="mt-5">
            <p className="text-xs text-[#6b6460] mb-1.5 font-medium">Reported Message / Offer Details</p>
            <div className="bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-4 py-3 text-sm text-[#a09890] leading-relaxed whitespace-pre-wrap">
              {r.offerMessage}
            </div>
          </div>
        )}

        {r.additionalNotes && (
          <div className="mt-4">
            <p className="text-xs text-[#6b6460] mb-1 font-medium">Additional Notes</p>
            <p className="text-xs text-[#a09890] bg-[#0f0f0f] border border-[#2f2f2f] rounded-lg px-4 py-2.5">
              {r.additionalNotes}
            </p>
          </div>
        )}
      </div>

      {/* Risk Factors */}
      {riskFactors.length > 0 && (
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">Risk Factors ({riskFactors.length})</h2>
          <div className="space-y-4">
            {riskFactors.map((f, i) => (
              <div key={i} className="border border-[#2f2f2f] rounded-lg p-4 bg-[#121212]">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <ConfidencePip confidence={f.confidence} />
                    <span className="text-sm font-medium text-[#f0ede8]">{f.description}</span>
                  </div>
                  <span className="text-xs text-amber-400 font-semibold">+{f.weight} pts</span>
                </div>
                <div className="w-full bg-[#2f2f2f] rounded-full h-1.5 mb-3">
                  <div
                    className="bg-amber-500 h-1.5 rounded-full"
                    style={{ width: `${Math.min((f.weight / 35) * 100, 100)}%` }}
                  />
                </div>
                {f.explanation && (
                  <p className="text-xs text-[#a09890] mb-2 leading-relaxed">{f.explanation}</p>
                )}
                {(f.evidenceText || f.evidence) && (
                  <div className="bg-[#0a0a0a] rounded px-3 py-2 text-xs text-[#6b6460] font-mono whitespace-pre-wrap">
                    {f.evidenceText || f.evidence}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shared Identifiers */}
      {identifiersList.length > 0 && (
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">Observed Identifiers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[#6b6460] text-left border-b border-[#2f2f2f]">
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Value</th>
                  <th className="pb-2 pr-4">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1c]">
                {identifiersList.map((id) => (
                  <tr key={id.id || `${id.type}-${id.value}`}>
                    <td className="py-2.5 pr-4">
                      <span className="text-xs uppercase text-[#6b6460] font-mono">{id.type}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <MaskedValue value={id.value} />
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[#a09890] capitalize">
                      {id.confidence}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Connected Reports */}
      {relatedReports.length > 0 && (
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-6">
          <h2 className="font-semibold text-[#f0ede8] mb-4">
            Connected Reports ({relatedReports.length})
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {relatedReports.slice(0, 6).map((cr) => {
              const crScore = cr.currentRisk?.score ?? cr.riskScore ?? 0;
              const crCategory = cr.currentRisk?.category || cr.riskCategory || (crScore >= 80 ? 'critical' : crScore >= 60 ? 'high' : crScore >= 35 ? 'medium' : 'low');
              return (
                <Link
                  key={cr.id}
                  to={`/reports/${cr.id}`}
                  className="flex items-center justify-between rounded-lg border border-[#2f2f2f] bg-[#1c1c1c] px-4 py-3 hover:border-[#3a3a3a] transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-sm text-[#f0ede8] font-medium truncate">
                      {cr.companyName || cr.companyNameRaw || 'Incident Report'}
                    </p>
                    <p className="text-xs text-[#6b6460] font-mono mt-0.5">{cr.id.slice(0, 8)}...</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <RiskBadge score={crScore} category={crCategory} showScore={false} size="sm" />
                    <ExternalLink size={12} className="text-[#6b6460]" />
                  </div>
                </Link>
              );
            })}
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

  const [activeTab, setActiveTab] = useState('community'); // 'community' | 'my' | 'saved'
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('submittedAt');
  const [page, setPage] = useState(1);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      let res;
      if (activeTab === 'community') {
        res = await reportService.getReports({
          search: search || undefined,
          sortBy,
          sortOrder: 'desc',
          page,
          limit: 10,
        });
      } else if (activeTab === 'my') {
        res = await reportService.getMyReports({
          search: search || undefined,
          status: statusFilter || undefined,
          sortBy,
          sortOrder: 'desc',
          page,
          limit: 10,
        });
      } else if (activeTab === 'saved') {
        res = await reportService.getSavedReports({
          page,
          limit: 10,
        });
      }

      const list = res?.reports || [];
      setReports(list);
      setTotal(res?.pagination?.total ?? list.length);
      setTotalPages(res?.pagination?.totalPages ?? 1);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to fetch reports.');
      setReports([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, statusFilter, sortBy, page]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Reset page whenever filters or active tab change
  useEffect(() => {
    setPage(1);
  }, [activeTab, search, category, statusFilter, sortBy]);

  // Client-side category filtering across current page records
  const filteredReports = useMemo(() => {
    if (!category) return reports;
    return reports.filter((r) => {
      const cat = r.riskCategory || r.riskAssessments?.[0]?.category;
      return cat?.toLowerCase() === category.toLowerCase();
    });
  }, [reports, category]);

  if (id) {
    return (
      <PageLayout>
        <ReportDetail reportId={id} />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#f0ede8]">Reports</h1>
          <p className="text-sm text-[#a09890] mt-1">
            Browse verified job scam reports and community incident intelligence.
          </p>
        </div>
        <Link to="/submit">
          <Button variant="primary" size="sm" className="whitespace-nowrap">
            <FileText size={14} className="mr-1.5" /> Submit a Report
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      {user && (
        <div className="flex border-b border-[#2f2f2f] mb-5 gap-6 text-sm">
          <button
            onClick={() => { setActiveTab('community'); setStatusFilter(''); }}
            className={`pb-3 font-medium transition-colors cursor-pointer border-b-2 -mb-[1px] ${
              activeTab === 'community'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-[#a09890] hover:text-[#f0ede8]'
            }`}
          >
            Community Verified
          </button>
          <button
            onClick={() => { setActiveTab('my'); }}
            className={`pb-3 font-medium transition-colors cursor-pointer border-b-2 -mb-[1px] ${
              activeTab === 'my'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-[#a09890] hover:text-[#f0ede8]'
            }`}
          >
            My Submissions
          </button>
          <button
            onClick={() => { setActiveTab('saved'); setStatusFilter(''); }}
            className={`pb-3 font-medium transition-colors cursor-pointer border-b-2 -mb-[1px] ${
              activeTab === 'saved'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-[#a09890] hover:text-[#f0ede8]'
            }`}
          >
            Saved Bookmarks
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        {activeTab !== 'saved' && (
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6460]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, recruiter, or domain…"
              className="w-full bg-[#161616] border border-[#3a3a3a] rounded-lg pl-9 pr-3 py-2 text-sm text-[#f0ede8] placeholder-[#6b6460] focus:outline-none focus:border-amber-500/60"
            />
          </div>
        )}

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-[#a09890] focus:outline-none focus:border-amber-500/60 cursor-pointer"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)} Risk
            </option>
          ))}
        </select>

        {activeTab === 'my' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-[#a09890] focus:outline-none focus:border-amber-500/60 cursor-pointer"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        )}

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-[#a09890] focus:outline-none focus:border-amber-500/60 cursor-pointer"
        >
          {SORTS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.l}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[#6b6460] mb-4">
        Showing {filteredReports.length} of {total} reports
      </p>

      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : errorMsg ? (
        <div className="text-center py-20">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-4" />
          <p className="text-[#a09890]">{errorMsg}</p>
          <button
            onClick={() => fetchReports()}
            className="mt-3 text-amber-400 text-sm hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-20">
          <Filter size={40} className="text-[#2f2f2f] mx-auto mb-4" />
          <p className="text-[#a09890]">
            {activeTab === 'saved'
              ? 'You have not bookmarked any reports yet.'
              : 'No reports match your filters.'}
          </p>
          {(search || category || statusFilter) && (
            <button
              onClick={() => {
                setSearch('');
                setCategory('');
                setStatusFilter('');
              }}
              className="mt-3 text-amber-400 text-sm hover:underline cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[#2f2f2f]">
            <table className="w-full text-sm">
              <thead className="bg-[#161616]">
                <tr className="text-xs text-[#6b6460] text-left border-b border-[#2f2f2f]">
                  {['ID', 'Company', 'Recruiter', 'Risk', 'Category', 'Status', 'Date', ''].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1c] bg-[#0f0f0f]">
                {filteredReports.map((r) => {
                  const score = r.riskScore ?? r.riskAssessments?.[0]?.score ?? 0;
                  const cat = r.riskCategory || r.riskAssessments?.[0]?.category || (score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low');
                  const dateStr = r.submittedAt
                    ? new Date(r.submittedAt).toLocaleDateString()
                    : '—';
                  const company = r.company?.name || r.companyNameRaw || 'Unspecified';
                  const recruiter = r.recruiter?.name || r.recruiterNameRaw || '—';

                  return (
                    <tr key={r.id} className="hover:bg-[#161616] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[#6b6460]">
                        {r.id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-[#f0ede8] font-medium max-w-40 truncate">
                        {company}
                      </td>
                      <td className="px-4 py-3 text-[#a09890] whitespace-nowrap">
                        {recruiter}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-[#f0ede8]">{score}</span>
                      </td>
                      <td className="px-4 py-3">
                        <RiskBadge score={null} category={cat} showScore={false} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium ${
                            r.status === 'verified'
                              ? 'text-green-400'
                              : r.status === 'investigating'
                              ? 'text-blue-400'
                              : r.status === 'rejected'
                              ? 'text-red-400'
                              : 'text-[#6b6460]'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6b6460] text-xs whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/reports/${r.id}`}
                          className="text-amber-400 hover:text-amber-300 text-xs whitespace-nowrap"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-[#6b6460]">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={14} /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
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
