import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, LoaderCircle, ShieldCheck } from 'lucide-react';
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
    <div className="grid min-h-dvh lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="auth-panel relative hidden flex-col justify-between overflow-hidden bg-[#142c28] p-12 text-white lg:flex xl:p-16">
        <Brand light />
        <div className="relative z-10 max-w-md py-16">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-emerald-100">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            One team. A connected workspace.
          </span>
          <h1 className="text-5xl leading-[1.12] font-medium tracking-[-0.045em] xl:text-6xl">
            Good work starts
            <br />
            with the{' '}
            <span className="text-emerald-200">
              right
              <br />
              connections.
            </span>
          </h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-white/60">
            Bring sales, warehouse, customer accounts, and finance together in
            one place.
          </p>
          <div className="mt-10 space-y-4">
            {[
              'A workspace built around your role',
              'A single place to manage your team',
              'Secure access, from the first sign in',
            ].map((text) => (
              <div
                className="flex items-center gap-3 text-sm text-white/80"
                key={text}
              >
                <span className="grid size-5 place-items-center rounded-full bg-emerald-200/10 text-emerald-200">
                  <Check className="size-3" />
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-xs text-white/40">
          A little structure. More room to grow.
        </p>
      </aside>
      <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
          <div className="lg:hidden">
            <Brand />
          </div>
          <p className="text-sm text-muted-foreground sm:ml-auto">
            {register ? 'Already part of the team?' : 'New to the workspace?'}{' '}
            <Link
              className="ml-1 font-medium text-foreground hover:underline"
              to={register ? '/login' : '/register'}
            >
              {register ? 'Sign in' : 'Create an account'}{' '}
              <span aria-hidden="true">↗</span>
            </Link>
          </p>
        </div>
        <div className="m-auto w-full max-w-sm py-16">
          <span className="mb-6 grid size-12 place-items-center rounded-2xl border bg-card text-primary shadow-xs">
            <ShieldCheck className="size-6" />
          </span>
          <p className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
            Your team workspace
          </p>
          <h2 className="text-3xl font-semibold tracking-tight">
            {register ? 'Make yourself at home.' : 'Welcome back.'}
          </h2>
          <p className="mt-3 mb-8 text-sm leading-relaxed text-muted-foreground">
            {register
              ? 'Create your account to join the Sales workspace. Your admin can update your role.'
              : 'Sign in to your account and pick up where you left off.'}
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
              {!pending && <ArrowRight className="ml-auto" />}
            </Button>
          </form>
          <div className="mt-8 flex items-center justify-center gap-2 border-t pt-6 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Your workspace. Only the access you need.
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          FieldDesk CRM · Team workspace
        </p>
      </main>
    </div>
  );
}
