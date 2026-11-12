import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Shield, Menu, X, ChevronDown, LogOut, LayoutDashboard, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const NAV_LINKS = [
  { to: '/', label: 'Home', exact: true },
  { to: '/reports', label: 'Reports' },
  { to: '/graph', label: 'Trust Graph' },
];

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setUserMenuOpen(false);
    navigate('/');
  };

  const linkClass = ({ isActive }) =>
    `text-sm transition-colors ${isActive ? 'text-amber-400 font-medium' : 'text-[#a09890] hover:text-[#f0ede8]'}`;

  return (
    <nav className="fixed top-0 inset-x-0 z-40 border-b border-[#2f2f2f]"
      style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <Shield size={20} className="text-amber-400" />
            <span className="font-bold text-[#f0ede8] tracking-tight">OfferCheck</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map(l => (
              <NavLink key={l.to} to={l.to} end={l.exact} className={linkClass}>{l.label}</NavLink>
            ))}
            {user && (
              <NavLink to="/check" className={linkClass}>Check Offer</NavLink>
            )}
            {user && (
              <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
            )}
            {user?.role === 'admin' && (
              <NavLink to="/admin" className={linkClass}>Admin</NavLink>
            )}
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(o => !o)}
                  className="flex items-center gap-2 text-sm text-[#a09890] hover:text-[#f0ede8] transition-colors cursor-pointer"
                >
                  <span className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-xs font-semibold">
                    {user.name?.[0]?.toUpperCase()}
                  </span>
                  <span className="max-w-24 truncate">{user.name}</span>
                  <ChevronDown size={14} />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-[#2f2f2f] bg-[#161616] shadow-xl py-1 z-50">
                    <div className="px-3 py-2 border-b border-[#2f2f2f]">
                      <p className="text-xs text-[#6b6460]">{user.email}</p>
                      <p className="text-xs text-amber-400 capitalize mt-0.5">{user.role}</p>
                    </div>
                    <Link to="/dashboard" onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-[#a09890] hover:text-[#f0ede8] hover:bg-[#232323] transition-colors">
                      <LayoutDashboard size={14} /> Dashboard
                    </Link>
                    <button onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#a09890] hover:text-red-400 hover:bg-[#232323] transition-colors cursor-pointer">
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="text-sm text-[#a09890] hover:text-[#f0ede8] transition-colors">Log in</Link>
                <Link to="/signup" className="text-sm bg-amber-500 hover:bg-amber-600 text-black font-semibold px-3 py-1.5 rounded-lg transition-colors">Sign up</Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden text-[#a09890] hover:text-[#f0ede8] transition-colors cursor-pointer"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#2f2f2f] bg-[#0f0f0f] px-4 py-4 flex flex-col gap-3">
          {NAV_LINKS.map(l => (
            <NavLink key={l.to} to={l.to} end={l.exact}
              className={({ isActive }) => `text-sm ${isActive ? 'text-amber-400 font-medium' : 'text-[#a09890]'}`}
              onClick={() => setMobileOpen(false)}>
              {l.label}
            </NavLink>
          ))}
          {user && <NavLink to="/check" className="text-sm text-[#a09890]" onClick={() => setMobileOpen(false)}>Check Offer</NavLink>}
          {user && <NavLink to="/dashboard" className="text-sm text-[#a09890]" onClick={() => setMobileOpen(false)}>Dashboard</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className="text-sm text-[#a09890]" onClick={() => setMobileOpen(false)}>Admin</NavLink>}
          <div className="border-t border-[#2f2f2f] pt-3 mt-1">
            {user ? (
              <button onClick={() => { handleLogout(); setMobileOpen(false); }}
                className="text-sm text-red-400 cursor-pointer">
                Sign out
              </button>
            ) : (
              <div className="flex gap-3">
                <Link to="/login" onClick={() => setMobileOpen(false)} className="text-sm text-[#a09890]">Log in</Link>
                <Link to="/signup" onClick={() => setMobileOpen(false)} className="text-sm text-amber-400">Sign up</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

