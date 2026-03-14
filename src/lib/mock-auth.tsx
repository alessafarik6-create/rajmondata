
"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Role } from './types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, role: Role) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate checking session
    const savedUser = localStorage.getItem('bizforge_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = (email: string, role: Role) => {
    const newUser: User = {
      id: 'u-' + Math.random().toString(36).substr(2, 9),
      name: email.split('@')[0],
      email,
      role,
      companyId: role === 'super_admin' ? undefined : 'c-1',
      avatar: `https://picsum.photos/seed/${email}/100/100`
    };
    setUser(newUser);
    localStorage.setItem('bizforge_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('bizforge_user');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
