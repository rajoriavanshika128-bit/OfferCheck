import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Shield, FileText, Fingerprint, Network, ScrollText, ChevronDown, ChevronRight } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Modal } from '../components/common/Modal';
import { Button } from '../components/common/Button';
import { getAdminStats, getReports, updateReportStatus, getAuditLogs, getClusters } from '../services/mockApi';
import { identifiers } from '../data/identifiers';
import { useToast } from '../contexts/ToastContext';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Shield },
  { id: 'reports', label: 'Report Moderation', icon: FileText },
  { id: 'identifiers', label: 'Identifiers', icon: Fingerprint },
  { id: 'clusters', label: 'Clusters', icon: Network },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

const STATUS_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
const STATUS_OPTS = ['all', 'pending', 'verified', 'rejected', 'investigating'];

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminStats().then(s => { setStats(s); setLoading(false); });
  }, []);

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;

  const statCards = [
    { label: 'Total Reports', value: stats.totalReports, color: 'text-[#f0ede8]' },
    { label: 'Pending Review', value: stats.pendingReports, color: 'text-amber-400' },
    { label: 'Verified', value: stats.verifiedReports, color: 'text-green-400' },
    { label: 'Rejected', value: stats.rejectedReports, color: 'text-red-400' },
    { label: 'Investigating', value: stats.investigatingReports, color: 'text-blue-400' },
  ];

  const riskData = [
    { name: 'Critical', count: stats.criticalReports, color: '#ef4444' },
    { name: 'High', count: stats.highReports, color: '#f97316' },
    { name: 'Medium', count: stats.mediumReports, color: '#eab308' },
    { name: 'Low', count: stats.lowReports, color: '#22c55e' },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map(c => (
          <div key={c.label} className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-4">
            <p className="text-xs text-[#6b6460] mb-1">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Risk distribution chart */}
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
          <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Risk Distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={riskData} barSize={36}>
              <XAxis dataKey="name" tick={{ fill: '#6b6460', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b6460', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1c1c1c', border: '1px solid #2f2f2f', borderRadius: 8, color: '#f0ede8', fontSize: 12 }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {riskData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Identifier & cluster summary */}
        <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Database Summary</h2>
          <div className="space-y-3">
            {[
              { label: 'Total Identifiers', value: stats.totalIdentifiers },
              { label: 'Flagged Identifiers', value: stats.flaggedIdentifiers, highlight: true },
              { label: 'Active Clusters', value: stats.activeClusters },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-2 border-b border-[#1c1c1c]">
                <span className="text-sm text-[#a09890]">{item.label}</span>
                <span className={`text-sm font-semibold ${item.highlight ? 'text-red-400' : 'text-[#f0ede8]'}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Report Moderation Tab ─────────────────────────────────────────────────────
function ModerationTab() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState(null); // { report, newStatus }
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    getReports({}, 'admin').then(d => { setReports(d.reports || d); setLoading(false); });
  }, []);

  const filtered = statusFilter === 'all' ? reports : reports.filter(r => r.status === statusFilter);

  const openModal = (report, newStatus) => {
    setActionTarget({ report, newStatus });
    setNotes('');
    setModalOpen(true);
  };

  const confirmAction = async () => {
    if (!actionTarget) return;
    setUpdating(true);
    try {
      await updateReportStatus(actionTarget.report.id, actionTarget.newStatus, notes);
      setReports(prev => prev.map(r =>
        r.id === actionTarget.report.id ? { ...r, status: actionTarget.newStatus } : r
      ));
      addToast(`Report ${actionTarget.report.id} marked as ${actionTarget.newStatus}`, 'success');
      setModalOpen(false);
    } catch {
      addToast('Failed to update status. Please try again.', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const ACTION_BTNS = [
    { status: 'verified', label: 'Verify', cls: 'text-green-400 hover:bg-green-500/10 border-green-500/30' },
    { status: 'investigating', label: 'Investigate', cls: 'text-blue-400 hover:bg-blue-500/10 border-blue-500/30' },
    { status: 'rejected', label: 'Reject', cls: 'text-red-400 hover:bg-red-500/10 border-red-500/30' },
  ];

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#161616] border border-[#3a3a3a] text-[#f0ede8] text-sm rounded-lg px-3 py-1.5 cursor-pointer"
          >
            {STATUS_OPTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <span className="text-sm text-[#6b6460]">{filtered.length} reports</span>
        </div>

        <div className="rounded-xl border border-[#2f2f2f] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#161616] border-b border-[#2f2f2f]">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Company</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460] hidden sm:table-cell">Risk</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[#6b6460]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c1c1c]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#6b6460]">No reports match filter.</td>
                </tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="bg-[#0f0f0f] hover:bg-[#161616] transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/reports/${r.id}`} className="text-amber-400 hover:underline font-mono text-xs">{r.id}</Link>
                  </td>
                  <td className="px-4 py-3 text-[#f0ede8] max-w-[160px] truncate">{r.companyName}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <RiskBadge score={r.riskScore} category={r.riskCategory} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs capitalize font-medium ${
                      r.status === 'verified' ? 'text-green-400' :
                      r.status === 'rejected' ? 'text-red-400' :
                      r.status === 'investigating' ? 'text-blue-400' :
                      'text-amber-400'
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {ACTION_BTNS.filter(a => a.status !== r.status).map(a => (
                        <button key={a.status}
                          onClick={() => openModal(r, a.status)}
                          className={`text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${a.cls}`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}
        title={`Mark as "${actionTarget?.newStatus}"`}>
        <div className="space-y-4">
          <p className="text-sm text-[#a09890]">
            Changing status of <span className="text-[#f0ede8] font-medium">{actionTarget?.report?.companyName}</span> ({actionTarget?.report?.id}) to{' '}
            <span className="font-semibold capitalize text-[#f0ede8]">{actionTarget?.newStatus}</span>.
          </p>
          <div>
            <label className="block text-xs text-[#6b6460] mb-1.5">Review notes (optional)</label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add context or reason for this status change…"
              className="w-full bg-[#1c1c1c] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm text-[#f0ede8] placeholder-[#6b6460] resize-none focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={updating} onClick={confirmAction}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Identifier Management Tab ─────────────────────────────────────────────────
function IdentifiersTab() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [flaggedFilter, setFlaggedFilter] = useState('all');
  const [search, setSearch] = useState('');

  const types = ['all', 'upi', 'phone', 'email', 'domain', 'bank_account'];
  const flagOpts = [{ v: 'all', l: 'All' }, { v: 'true', l: 'Flagged' }, { v: 'false', l: 'Not flagged' }];

  const filtered = identifiers.filter(id => {
    if (typeFilter !== 'all' && id.type !== typeFilter) return false;
    if (flaggedFilter === 'true' && !id.flagged) return false;
    if (flaggedFilter === 'false' && id.flagged) return false;
    if (search && !id.value.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const TYPE_COLORS = {
    upi: 'text-red-400', phone: 'text-blue-400', email: 'text-purple-400',
    domain: 'text-green-400', bank_account: 'text-cyan-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search identifiers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] text-[#f0ede8] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500/50 w-48"
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] text-[#f0ede8] text-sm rounded-lg px-3 py-1.5 cursor-pointer">
          {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace('_', ' ')}</option>)}
        </select>
        <select value={flaggedFilter} onChange={e => setFlaggedFilter(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] text-[#f0ede8] text-sm rounded-lg px-3 py-1.5 cursor-pointer">
          {flagOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <span className="text-sm text-[#6b6460]">{filtered.length} identifiers</span>
      </div>

      <div className="rounded-xl border border-[#2f2f2f] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#161616] border-b border-[#2f2f2f]">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Value (full)</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460] hidden md:table-cell">Reports</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460] hidden lg:table-cell">Risk</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1c1c1c]">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#6b6460]">No identifiers match filters.</td></tr>
            ) : filtered.map(id => (
              <tr key={id.id} className="bg-[#0f0f0f] hover:bg-[#161616] transition-colors">
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium capitalize ${TYPE_COLORS[id.type] || 'text-[#a09890]'}`}>
                    {id.type.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[#f0ede8] max-w-[200px] truncate" title={id.value}>
                  {id.value}
                </td>
                <td className="px-4 py-3 text-[#a09890] hidden md:table-cell">{id.reportIds.length}</td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className={`text-xs font-semibold ${
                    id.riskScore >= 80 ? 'text-red-400' : id.riskScore >= 60 ? 'text-orange-400' :
                    id.riskScore >= 40 ? 'text-yellow-400' : 'text-green-400'
                  }`}>{id.riskScore}</span>
                </td>
                <td className="px-4 py-3">
                  {id.flagged
                    ? <span className="text-xs font-medium text-red-400">Flagged</span>
                    : <span className="text-xs text-[#6b6460]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-amber-500/70 flex items-center gap-1">
        <Shield size={11} /> Admin view — full identifier values shown. Not visible to student users.
      </p>
    </div>
  );
}

// ─── Clusters Tab ─────────────────────────────────────────────────────────────
function ClustersTab() {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    getClusters().then(c => { setClusters(c); setLoading(false); });
  }, []);

  const toggle = id => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="space-y-3">
      {clusters.map(c => {
        const isOpen = expanded.has(c.id);
        const confColor = c.confidence === 'high' ? 'text-green-400' : c.confidence === 'medium' ? 'text-yellow-400' : 'text-orange-400';
        return (
          <div key={c.id} className="rounded-xl border border-[#2f2f2f] bg-[#0f0f0f] overflow-hidden">
            <button
              onClick={() => toggle(c.id)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[#161616] transition-colors cursor-pointer text-left"
            >
              {isOpen ? <ChevronDown size={16} className="text-[#6b6460] shrink-0" /> : <ChevronRight size={16} className="text-[#6b6460] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-[#f0ede8]">{c.name}</span>
                  <span className="text-xs text-[#6b6460] font-mono">{c.id}</span>
                  <span className={`text-xs ${confColor}`}>{c.confidence} confidence</span>
                </div>
                <p className="text-xs text-[#6b6460] mt-0.5 truncate">{c.description}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-[#6b6460]">Reports</p>
                  <p className="text-sm font-semibold text-[#f0ede8]">{c.totalReports}</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-[#6b6460]">Risk</p>
                  <p className={`text-sm font-semibold ${c.riskScore >= 80 ? 'text-red-400' : c.riskScore >= 60 ? 'text-orange-400' : 'text-yellow-400'}`}>{c.riskScore}</p>
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="px-5 pb-4 border-t border-[#1c1c1c] pt-3 space-y-3">
                <div className="bg-[#161616] rounded-lg p-3">
                  <p className="text-xs font-semibold text-[#6b6460] mb-1">Connection Basis</p>
                  <p className="text-sm text-[#a09890] leading-relaxed">{c.connectionBasis}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#6b6460] mb-2">Reports in cluster</p>
                  <div className="flex flex-wrap gap-1.5">
                    {c.reportIds.map(rid => (
                      <Link key={rid} to={`/reports/${rid}`}
                        className="text-xs px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors">
                        {rid}
                      </Link>
                    ))}
                  </div>
                </div>
                {c.identifierIds?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#6b6460] mb-2">Shared identifiers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {c.identifierIds.map(iid => (
                        <span key={iid} className="text-xs px-2.5 py-1 bg-[#1c1c1c] border border-[#2f2f2f] text-[#a09890] rounded-lg font-mono">{iid}</span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-[#6b6460]">Discovered: {c.discoveredAt}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Audit Log Tab ─────────────────────────────────────────────────────────────
function AuditTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');

  const ACTION_TYPES = ['all', 'STATUS_CHANGED', 'CLUSTER_CREATED', 'IDENTIFIER_FLAGGED', 'REPORT_FLAGGED', 'REPORT_REVIEWED'];

  useEffect(() => {
    getAuditLogs({}).then(l => { setLogs(l); setLoading(false); });
  }, []);

  const filtered = actionFilter === 'all' ? logs : logs.filter(l => l.action === actionFilter);

  const fmtTime = ts => {
    try { return new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return ts; }
  };

  const ACTION_COLORS = {
    STATUS_CHANGED: 'text-blue-400',
    CLUSTER_CREATED: 'text-purple-400',
    IDENTIFIER_FLAGGED: 'text-red-400',
    REPORT_FLAGGED: 'text-orange-400',
    REPORT_REVIEWED: 'text-green-400',
  };

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          className="bg-[#161616] border border-[#3a3a3a] text-[#f0ede8] text-sm rounded-lg px-3 py-1.5 cursor-pointer">
          {ACTION_TYPES.map(a => <option key={a} value={a}>{a === 'all' ? 'All actions' : a.replace('_', ' ')}</option>)}
        </select>
        <span className="text-sm text-[#6b6460]">{filtered.length} entries</span>
      </div>

      <div className="rounded-xl border border-[#2f2f2f] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#161616] border-b border-[#2f2f2f]">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Action</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Report</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460] hidden sm:table-cell">By</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460] hidden md:table-cell">Change</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460] hidden lg:table-cell">Notes</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6460]">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1c1c1c]">
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[#6b6460]">No log entries match filter.</td></tr>
            ) : filtered.map(log => (
              <tr key={log.id} className="bg-[#0f0f0f] hover:bg-[#161616] transition-colors">
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${ACTION_COLORS[log.action] || 'text-[#a09890]'}`}>
                    {log.action.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {log.reportId
                    ? <Link to={`/reports/${log.reportId}`} className="text-amber-400 hover:underline font-mono text-xs">{log.reportId}</Link>
                    : <span className="text-[#6b6460]">—</span>}
                </td>
                <td className="px-4 py-3 text-[#a09890] text-xs hidden sm:table-cell">{log.userName}</td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {log.oldStatus && log.newStatus ? (
                    <span className="text-xs text-[#a09890]">
                      <span className="text-[#6b6460] capitalize">{log.oldStatus}</span>
                      {' → '}
                      <span className="capitalize text-[#f0ede8]">{log.newStatus}</span>
                    </span>
                  ) : <span className="text-[#6b6460]">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-[#6b6460] max-w-[160px] truncate hidden lg:table-cell" title={log.notes}>
                  {log.notes || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-[#6b6460] whitespace-nowrap">{fmtTime(log.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main AdminPage ─────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('overview');

  const TAB_CONTENT = {
    overview: <OverviewTab />,
    reports: <ModerationTab />,
    identifiers: <IdentifiersTab />,
    clusters: <ClustersTab />,
    audit: <AuditTab />,
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield size={20} className="text-amber-400" />
          <div>
            <h1 className="text-xl font-bold text-[#f0ede8]">Admin Panel</h1>
            <p className="text-xs text-[#6b6460] mt-0.5">Moderation · Identifiers · Clusters · Audit Log</p>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-[#2f2f2f] overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-amber-500 text-amber-400'
                    : 'border-transparent text-[#6b6460] hover:text-[#a09890]'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div>
          {TAB_CONTENT[activeTab]}
        </div>
      </div>
    </PageLayout>
  );
}

