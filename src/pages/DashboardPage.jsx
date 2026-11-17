import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, AlertTriangle, AlertCircle, TrendingUp, FileText, Shield } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { checkService } from '../services/checkService';
import { useAuth } from '../contexts/AuthContext';

function StatCard({ label, value, sub, icon: Icon, accent = false }) {
  return (
    <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-[#6b6460] font-medium">{label}</p>
        {Icon && <Icon size={16} className={accent ? 'text-amber-400' : 'text-[#3a3a3a]'} />}
      </div>
      <p className={`text-3xl font-bold ${accent ? 'text-amber-400' : 'text-[#f0ede8]'}`}>{value}</p>
      {sub && <p className="text-xs text-[#6b6460] mt-1">{sub}</p>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const dataItem = payload[0].payload;
  return (
    <div className="bg-[#232323] border border-[#3a3a3a] rounded-lg px-3 py-2 text-xs">
      <p className="text-[#a09890]">{label} {dataItem?.date ? `(${dataItem.date})` : ''}</p>
      <p className="text-amber-400 font-semibold">{payload[0].value} check{payload[0].value === 1 ? '' : 's'}</p>
    </div>
  );
};

export default function DashboardPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Only the explicit isNewUser signup navigation flag activates the first-time greeting
  const [isFirstVisit] = useState(() => Boolean(location.state?.isNewUser));

  const stateConsumedRef = useRef(false);

  useEffect(() => {
    if (!user?.id) return;
    const storageKey = `offercheck_visited_${user.id}`;
    const isNewUserFromState = Boolean(location.state?.isNewUser);

    // Initialise or update account-specific visit marker safely
    try {
      localStorage.setItem(storageKey, 'true');
    } catch {
      // Safe fallback if localStorage is restricted or unavailable
    }

    // Consume and clear the isNewUser navigation state via replace navigation
    if (isNewUserFromState && !stateConsumedRef.current) {
      stateConsumedRef.current = true;
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [user?.id, location.pathname, location.state, navigate]);

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Computed once at mount — stable value, avoids react(purity) lint warning
  const [todayLabel] = useState(() =>
    new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  );

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const metrics = await checkService.getDashboardMetrics();
      setStats(metrics);
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  if (loading) {
    return (
      <PageLayout>
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center my-10 max-w-lg mx-auto">
          <AlertCircle className="text-red-400 mx-auto mb-3" size={32} />
          <h2 className="text-lg font-bold text-[#f0ede8] mb-1">Failed to load dashboard</h2>
          <p className="text-sm text-red-300 mb-4">{error}</p>
          <Button variant="primary" size="sm" onClick={fetchDashboardData}>
            Retry
          </Button>
        </div>
      </PageLayout>
    );
  }

  const safeStats = stats || {
    totalChecks: 0,
    reportsSubmitted: 0,
    savedReports: 0,
    highRiskChecks: 0,
    avgRiskScore: null,
    weeklyActivity: [],
    recentChecks: [],
  };

  const highRiskRecent = safeStats.recentChecks?.filter(
    (c) => c.riskCategory === 'critical' || c.riskCategory === 'high'
  ) || [];

  const weeklyTotal = safeStats.weeklyActivity?.reduce((sum, item) => sum + (item.checks || 0), 0) || 0;

  return (
    <PageLayout>
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-[#f0ede8]">
          {isFirstVisit ? 'Welcome' : 'Welcome back'}, {user?.name?.trim() ? user.name.trim().split(' ')[0] : 'Student'}!
        </h1>
        <p className="text-sm text-[#6b6460] mt-1">{todayLabel}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Checks" value={safeStats.totalChecks} icon={Search} accent />
        <StatCard
          label="Reports Submitted"
          value={safeStats.reportsSubmitted}
          sub={safeStats.savedReports > 0 ? `${safeStats.savedReports} saved report${safeStats.savedReports > 1 ? 's' : ''}` : undefined}
          icon={FileText}
        />
        <StatCard label="High-Risk Checks" value={safeStats.highRiskChecks} icon={AlertTriangle} />
        <StatCard
          label="Avg Risk Score"
          value={safeStats.avgRiskScore !== null && safeStats.avgRiskScore !== undefined ? safeStats.avgRiskScore : '—'}
          sub={safeStats.avgRiskScore !== null ? 'across personal checks' : 'no checks recorded'}
          icon={TrendingUp}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: chart + recent checks */}
        <div className="lg:col-span-2 space-y-5 min-w-0">
          {/* Weekly chart */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-[#f0ede8]">Weekly Activity</h2>
              <span className="text-xs text-[#6b6460]">{weeklyTotal} check{weeklyTotal === 1 ? '' : 's'} this week</span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={safeStats.weeklyActivity} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6b6460' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b6460' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(245,158,11,0.05)' }} />
                <Bar dataKey="checks" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent checks */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Recent Offer Checks</h2>
            {safeStats.recentChecks?.length > 0 ? (
              <div className="space-y-2">
                {safeStats.recentChecks.map((c) => (
                  <Link
                    key={c.id}
                    to={`/results/${c.id}`}
                    className="flex items-center justify-between rounded-lg bg-[#1c1c1c] border border-[#2f2f2f] px-4 py-3 hover:border-[#3a3a3a] transition-colors"
                  >
                    <div>
                      <p className="text-sm text-[#f0ede8]">{c.companyName || 'Unknown Company'}</p>
                      <p className="text-xs text-[#6b6460] mt-0.5">
                        {c.checkedAt ? new Date(c.checkedAt).toLocaleString('en-IN') : 'Recent'}
                      </p>
                    </div>
                    <RiskBadge score={c.riskScore} category={c.riskCategory} size="sm" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Search size={28} className="text-[#2f2f2f] mx-auto mb-2" />
                <p className="text-sm text-[#6b6460]">No checks performed yet.</p>
                <Link to="/check" className="mt-2 text-amber-400 text-sm hover:underline inline-block">
                  Check an offer →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Right: alerts + quick actions */}
        <div className="space-y-5">
          {/* Risk Alerts */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">High-Risk Alerts</h2>
            {highRiskRecent.length > 0 ? (
              <div className="space-y-2">
                {highRiskRecent.map((c) => (
                  <Link
                    key={c.id}
                    to={`/results/${c.id}`}
                    className="flex items-start gap-3 rounded-lg bg-[#1c1c1c] border border-[#2f2f2f] px-3 py-2.5 hover:border-red-500/20 transition-colors"
                  >
                    <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs text-[#f0ede8] truncate">{c.companyName || 'Unknown Company'}</p>
                      <p className="text-xs text-[#6b6460] mt-0.5">Risk Score: {c.riskScore ?? '—'} ({c.riskCategory})</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : safeStats.highRiskChecks > 0 ? (
              <p className="text-sm text-[#6b6460]">
                {safeStats.highRiskChecks} older high-risk check{safeStats.highRiskChecks > 1 ? 's' : ''} on record.
              </p>
            ) : (
              <p className="text-sm text-[#6b6460]">No high-risk checks detected.</p>
            )}
          </div>

          {/* Quick Actions */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { to: '/check', label: 'Check a new offer', icon: Search },
                { to: '/submit', label: 'Submit a report', icon: FileText },
                { to: '/reports', label: 'Browse all reports', icon: FileText },
                { to: '/graph', label: 'View trust graph', icon: Shield },
              ].map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="flex items-center gap-3 rounded-lg border border-[#2f2f2f] bg-[#1c1c1c] px-4 py-3 text-sm text-[#a09890] hover:text-[#f0ede8] hover:border-[#3a3a3a] transition-colors"
                >
                  <a.icon size={14} className="text-amber-400" />
                  {a.label}
                </Link>
              ))}
              {user?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <Shield size={14} /> Admin panel
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
