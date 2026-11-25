import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';

export function AppProviders({ children }: { children: ReactNode }) {
  const authStatus = useAuthStore((state) => state.status);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
        },
      }),
  );

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      queryClient.clear();
    }
  }, [authStatus, queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}