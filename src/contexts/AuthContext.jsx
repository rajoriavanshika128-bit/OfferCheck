import { createContext, useContext, useState, useEffect } from 'react';
import { DEMO_USERS } from '../data/users';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('offercheck_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Re-validate against demo users (password stripped before storing)
        const found = DEMO_USERS.find(u => u.id === parsed.id && u.email === parsed.email);
        if (found) {
          const { password: _, ...safeUser } = found;
          setUser(safeUser);
        }
      }
    } catch {
      localStorage.removeItem('offercheck_user');
    } finally {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const found = DEMO_USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!found) throw new Error('Invalid email or password. Try the demo credentials shown above.');
    const { password: _, ...safeUser } = found;
    setUser(safeUser);
    localStorage.setItem('offercheck_user', JSON.stringify(safeUser));
    return safeUser;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('offercheck_user');
  };

  const signup = async (name, email, _password) => {
    // Demo only: creates an in-memory session user, not persisted.
    // _password is accepted for API compatibility but intentionally unused —
    // the demo does not store or validate passwords for new signups.
    if (DEMO_USERS.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('This email is already registered. Try logging in instead.');
    }
    const newUser = {
      id: `U_${Date.now()}`,
      name,
      email,
      role: 'student',
      college: '',
      joinedAt: new Date().toISOString().split('T')[0],
      submittedReports: [],
      savedReports: [],
      checksPerformed: 0,
      _isDemoSession: true,
    };
    setUser(newUser);
    // Do NOT persist to localStorage — demo session only
    return newUser;
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, signup, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

