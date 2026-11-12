import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

export function PublicOnlyRoute() {
  const location = useLocation();
  const { status, user, initialize } = useAuthStore();

  useEffect(() => {
    if (status === 'idle') {
      void initialize();
    }
  }, [status, initialize]);

  if (status === 'idle' || status === 'checking') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  if (status === 'authenticated' && user) {
    const state = location.state as { from?: { pathname?: string } } | null;
    const redirectTo = state?.from?.pathname || '/dashboard';
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}