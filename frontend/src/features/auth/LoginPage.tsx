import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/common/Button';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ApiClientError } from '@/services/api-client';
import { useAuthStore } from '@/stores/auth.store';

const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      await login(values);
      const state = location.state as { from?: { pathname?: string } } | null;
      navigate(state?.from?.pathname || '/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setServerError(err.message);
      } else {
        setServerError('Unable to sign in. Please try again.');
      }
    }
  };

  return (
    <AuthLayout
      title="Sign in to AgentMemory"
      subtitle="Access your projects, memory namespaces, and benchmark analytics."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
          >
            {serverError}
          </div>
        )}

        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-text-primary mb-1">
            Email address <span className="text-error">*</span>
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-error mt-1">{errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-text-primary mb-1">
            Password <span className="text-error">*</span>
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs text-error mt-1">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Sign In
        </Button>

        <p className="text-sm text-text-secondary text-center pt-2">
          Need a workspace account?{' '}
          <Link to="/register" className="text-primary hover:underline font-medium">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}