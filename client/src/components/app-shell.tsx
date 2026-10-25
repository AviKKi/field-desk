import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { canAccess, ROLE_LABELS } from '@crm/shared/roles';
import { Brand } from './brand';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ErrorNotice } from './feedback';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, area: null },
  {
    to: '/sales',
    label: 'Sales workspace',
    icon: BriefcaseBusiness,
    area: 'sales',
  },
  { to: '/accounts', label: 'Key accounts', icon: Users, area: 'accounts' },
  { to: '/users', label: 'Team members', icon: ShieldCheck, area: 'users' },
] as const;

export function AppShell() {
  const user = useAuthStore((state) => state.user);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

  async function logout() {
    setPending(true);
    setError('');
    try {
      await useAuthStore.getState().logout();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-18 items-center justify-between border-b bg-card px-5 lg:hidden">
        <Brand />
        <Button
          variant="ghost"
          size="icon"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>
      </header>
      {menuOpen && (
        <div
          className="fixed inset-0 top-18 z-20 bg-black/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r bg-card px-5 py-7 max-lg:top-18 max-lg:transition-transform',
          !menuOpen && 'max-lg:invisible max-lg:-translate-x-full',
        )}
      >
        <Link
          to="/"
          className="mb-11 px-2 max-lg:hidden"
          aria-label="FieldDesk CRM home"
        >
          <Brand />
        </Link>
        <div className="mb-7 flex items-center gap-3 rounded-lg border bg-background p-3">
          <span className="grid size-9 place-items-center rounded-lg bg-secondary text-sm font-semibold text-primary">
            RE
          </span>
          <div>
            <p className="text-sm font-medium">Team workspace</p>
            <p className="text-xs text-muted-foreground">FieldDesk CRM</p>
          </div>
        </div>
        <p className="mb-3 px-3 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Workspace
        </p>
        <nav className="space-y-1" aria-label="Main navigation">
          {navigation
            .filter((item) => !item.area || canAccess(user.role, item.area))
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    isActive && 'bg-secondary font-medium text-primary',
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="mt-auto space-y-5 pt-10">
          <div className="rounded-xl border border-primary/10 bg-secondary/50 p-4">
            <ShieldCheck className="mb-3 size-5 text-primary" />
            <p className="text-sm font-medium">Your access, in sync.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your role connects you with the right tools and people.
            </p>
            <Link
              to="/"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              View your workspace <ArrowUpRight className="size-3" />
            </Link>
          </div>
          {error && <ErrorNotice message={error} />}
          <div className="flex items-center gap-2 border-t pt-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e5e9df] text-xs font-semibold text-primary uppercase">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              title="Sign out"
              disabled={pending}
              onClick={() => void logout()}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </aside>
      <div className="lg:pl-64">
        <div className="flex h-18 items-center justify-between gap-4 border-b bg-card/70 px-6 lg:px-10">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Workspace</span>
            <ChevronRight className="size-3" />
            <span className="text-foreground">{ROLE_LABELS[user.role]}</span>
          </div>
          <Badge className="gap-1.5 border border-primary/10 bg-card text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            {ROLE_LABELS[user.role]}
          </Badge>
        </div>
        <main id="main" className="mx-auto max-w-7xl p-6 lg:p-10">
          <Outlet />
        </main>
        <footer className="mx-6 flex flex-wrap items-center justify-between gap-2 border-t py-5 text-[11px] text-muted-foreground lg:mx-10">
          <span>FieldDesk CRM · Team workspace</span>
          <span>Connected by purpose.</span>
        </footer>
      </div>
    </div>
  );
}
