import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { loginSchema, registerSchema } from '@crm/shared/schemas';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorNotice } from '@/components/feedback';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';

export function AuthPage({ register = false }: { register?: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const destination = new URLSearchParams(location.search).get('next');
  const next =
    destination?.startsWith('/') &&
    !destination.startsWith('//') &&
    !destination.startsWith('/login') &&
    !destination.startsWith('/register')
      ? destination
      : '/';
  if (user) return <Navigate to={next} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    const input = {
      email: data.get('email'),
      password: data.get('password'),
      ...(register ? { name: data.get('name') } : {}),
    };
    const result = (register ? registerSchema : loginSchema).safeParse(input);
    if (!result.success) {
      setError(result.error.issues.map((issue) => issue.message).join('. '));
      return;
    }
    setPending(true);
    try {
      if (register)
        await useAuthStore.getState().register(registerSchema.parse(input));
      else await useAuthStore.getState().login(loginSchema.parse(input));
      navigate(next, { replace: true });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center bg-background px-5 py-10"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Brand />
        </div>
        <div className="rounded-xl border bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold">
            {register ? 'Create an account' : 'Sign in to FieldDesk'}
          </h1>
          <p className="mb-7 mt-2 text-sm text-muted-foreground">
            {register
              ? 'Create a Sales account. Your administrator can update your role.'
              : 'Enter your email and password to open your CRM.'}
          </p>
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            {register && (
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={pending}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
                maxLength={254}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={
                  register ? 'At least 12 characters' : 'Enter your password'
                }
                required
                minLength={register ? 12 : 1}
                maxLength={128}
                disabled={pending}
              />
              {register && (
                <p className="text-xs text-muted-foreground">
                  Use at least 12 characters. A passphrase works well.
                </p>
              )}
            </div>
            {error && <ErrorNotice message={error} />}
            <Button type="submit" className="h-11 w-full" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {register ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {register ? 'Already have an account?' : 'Need an account?'}{' '}
            <Link
              className="font-medium text-primary hover:underline"
              to={register ? '/login' : '/register'}
            >
              {register ? 'Sign in' : 'Create account'}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
