import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

export function ProtectedRoute() {
  const location = useLocation();
  const { status, user, initialize } = useAuthStore();

  useEffect(() => {
    if (status === 'idle') {
      void initialize();
    }
  }, [status, initialize]);

  if (status === 'idle' || status === 'checking') {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-text-secondary">Verifying authenticated session...</p>
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}