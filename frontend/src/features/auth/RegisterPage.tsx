import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/common/Button';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ApiClientError } from '@/services/api-client';
import { useAuthStore } from '@/stores/auth.store';

const registerSchema = z
  .object({
    display_name: z.string().max(150, 'Display name must be 150 characters or fewer').optional(),
    email: z.email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const registerUser = useAuthStore((state) => state.register);
  const login = useAuthStore((state) => state.login);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { display_name: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    try {
      await registerUser({
        email: values.email,
        password: values.password,
        display_name: values.display_name?.trim() || null,
      });
      await login({ email: values.email, password: values.password });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setServerError(err.message);
      } else {
        setServerError('Unable to register account. Please try again.');
      }
    }
  };

  return (
    <AuthLayout
      title="Create Researcher Account"
      subtitle="Set up your isolated AgentMemory workspace."
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
          <label htmlFor="reg-name" className="block text-sm font-medium text-text-primary mb-1">
            Display name
          </label>
          <input
            id="reg-name"
            type="text"
            autoComplete="name"
            placeholder="Optional (defaults to email prefix)"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('display_name')}
          />
          {errors.display_name && (
            <p className="text-xs text-error mt-1">{errors.display_name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="reg-email" className="block text-sm font-medium text-text-primary mb-1">
            Email address <span className="text-error">*</span>
          </label>
          <input
            id="reg-email"
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
          <label htmlFor="reg-password" className="block text-sm font-medium text-text-primary mb-1">
            Password <span className="text-error">*</span>
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs text-error mt-1">{errors.password.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="reg-confirm" className="block text-sm font-medium text-text-primary mb-1">
            Confirm password <span className="text-error">*</span>
          </label>
          <input
            id="reg-confirm"
            type="password"
            autoComplete="new-password"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-error mt-1">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button type="submit" isLoading={isSubmitting} className="w-full">
          Create Account
        </Button>

        <p className="text-sm text-text-secondary text-center pt-2">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}