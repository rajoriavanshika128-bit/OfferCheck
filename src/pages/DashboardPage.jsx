import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, AlertTriangle, TrendingUp, FileText, Shield } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { getDashboardStats } from '../services/mockApi';
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
  return (
    <div className="bg-[#232323] border border-[#3a3a3a] rounded-lg px-3 py-2 text-xs">
      <p className="text-[#a09890]">{label}</p>
      <p className="text-amber-400 font-semibold">{payload[0].value} checks</p>
    </div>
  );
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats(user?.id)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return <PageLayout><div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div></PageLayout>;

  return (
    <PageLayout>
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-[#f0ede8]">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-[#6b6460] mt-1">{new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Checks" value={stats.totalChecks} icon={Search} accent />
        <StatCard label="Reports Submitted" value={stats.reportsSubmitted} icon={FileText} />
        <StatCard label="Active Alerts" value={stats.activeAlerts} icon={AlertTriangle} />
        <StatCard label="Avg Risk Score" value={stats.avgRiskScore} sub="across all reports" icon={TrendingUp} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: chart + recent checks */}
        <div className="lg:col-span-2 space-y-5">
          {/* Weekly chart */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-5">Weekly Activity</h2>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={stats.weeklyActivity} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6b6460' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b6460' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(245,158,11,0.05)' }} />
                <Bar dataKey="checks" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent checks */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Recent Offer Checks</h2>
            {stats.recentChecks?.length > 0 ? (
              <div className="space-y-2">
                {stats.recentChecks.map(c => (
                  <Link key={c.checkId} to={`/results/${c.checkId}`}
                    className="flex items-center justify-between rounded-lg bg-[#1c1c1c] border border-[#2f2f2f] px-4 py-3 hover:border-[#3a3a3a] transition-colors">
                    <div>
                      <p className="text-sm text-[#f0ede8]">{c.formData?.companyName || 'Unknown Company'}</p>
                      <p className="text-xs text-[#6b6460] mt-0.5">{new Date(c.timestamp).toLocaleString('en-IN')}</p>
                    </div>
                    <RiskBadge score={c.riskScore} category={c.riskCategory} size="sm" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Search size={28} className="text-[#2f2f2f] mx-auto mb-2" />
                <p className="text-sm text-[#6b6460]">No checks this session yet.</p>
                <Link to="/check" className="mt-2 text-amber-400 text-sm hover:underline inline-block">Check an offer →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Right: alerts + quick actions */}
        <div className="space-y-5">
          {/* Risk Alerts */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Risk Alerts</h2>
            {stats.riskAlerts?.length > 0 ? (
              <div className="space-y-2">
                {stats.riskAlerts.map(r => (
                  <Link key={r.id} to={`/reports/${r.id}`}
                    className="flex items-start gap-3 rounded-lg bg-[#1c1c1c] border border-[#2f2f2f] px-3 py-2.5 hover:border-red-500/20 transition-colors">
                    <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs text-[#f0ede8] truncate">{r.companyName}</p>
                      <p className="text-xs text-[#6b6460] mt-0.5">Score: {r.riskScore}</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : <p className="text-sm text-[#6b6460]">No active critical alerts.</p>}
          </div>

          {/* Quick Actions */}
          <div className="rounded-xl border border-[#2f2f2f] bg-[#161616] p-5">
            <h2 className="text-sm font-semibold text-[#f0ede8] mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { to: '/check', label: 'Check a new offer', icon: Search },
                { to: '/reports', label: 'Browse all reports', icon: FileText },
                { to: '/graph', label: 'View trust graph', icon: Shield },
              ].map(a => (
                <Link key={a.to} to={a.to}
                  className="flex items-center gap-3 rounded-lg border border-[#2f2f2f] bg-[#1c1c1c] px-4 py-3 text-sm text-[#a09890] hover:text-[#f0ede8] hover:border-[#3a3a3a] transition-colors">
                  <a.icon size={14} className="text-amber-400" />
                  {a.label}
                </Link>
              ))}
              {user?.role === 'admin' && (
                <Link to="/admin"
                  className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors">
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

