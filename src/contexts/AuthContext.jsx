import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import authService from '../services/authService.js';
import { onAuthExpired } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => authService.getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      if (authService.isAuthenticated()) {
        try {
          const freshUser = await authService.getCurrentUser();
          if (mounted && freshUser) {
            setUser(freshUser);
          }
        } catch {
          // If token refresh or me lookup failed, clear invalid state
          if (mounted) {
            setUser(null);
          }
        }
      } else {
        if (mounted) {
          setUser(null);
        }
      }

      if (mounted) {
        setLoading(false);
      }
    }

    initializeAuth();

    // Listen for session expiration events dispatched by api client
    const unsubscribe = onAuthExpired(() => {
      if (mounted) {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const loggedInUser = await authService.login(email, password);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const signup = useCallback(async (name, email, password, college) => {
    const signedUpUser = await authService.signup(name, email, password, college);
    setUser(signedUpUser);
    return signedUpUser;
  }, []);

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

