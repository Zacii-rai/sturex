/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { Storefront } from './components/Storefront';
import { ToastProvider } from './components/Toast';

type AppRoute = 'storefront' | 'admin';

function resolveRouteFromPath(): AppRoute {
  return window.location.pathname.startsWith('/admin') ? 'admin' : 'storefront';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(resolveRouteFromPath);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sturex_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('sturex_theme', darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  useEffect(() => {
    const onPopState = () => setRoute(resolveRouteFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextRoute: AppRoute) => {
    const targetPath = nextRoute === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0 });
  };

  return (
    <ToastProvider>
      {route === 'admin' ? (
        <AdminDashboard
          darkMode={darkMode}
          onToggleTheme={() => setDarkMode((d) => !d)}
          onBackToStore={() => navigate('storefront')}
        />
      ) : (
        <Storefront
          darkMode={darkMode}
          onToggleTheme={() => setDarkMode((d) => !d)}
          onNavigateAdmin={() => navigate('admin')}
        />
      )}
    </ToastProvider>
  );
}
