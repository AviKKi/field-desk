import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  UsersRound,
  ShoppingBag,
  Wallet,
  LogOut,
  Menu,
  ShieldCheck,
  X,
  ChevronRight,
} from 'lucide-react';
import { ROLE_LABELS } from '@crm/shared/roles';
import { Brand } from './brand';
import { Button } from './ui/button';
import { NativeSelect } from './ui/native-select';
import { ErrorNotice } from './feedback';
import { useAuthStore } from '@/store/auth-store';
import { useCrmStore } from '@/store/crm-store';
import { useCrm } from '@/features/crm/context';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';
const navigation = [
  { to: '/customers', label: 'Customers', icon: UsersRound },
  { to: '/orders', label: 'Sales orders', icon: ShoppingBag },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
];
export function AppShell() {
  const user = useAuthStore((state) => state.user)!;
  const { data, actor, notice, notify, error: crmError } = useCrm();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const title = location.pathname.startsWith('/users')
    ? 'Team members'
    : (navigation.find((item) => location.pathname.startsWith(item.to))
        ?.label ?? 'CRM');
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
  const links = [
    ...navigation,
    ...(user.role === 'ADMIN'
      ? [{ to: '/users', label: 'Team members', icon: ShieldCheck }]
      : []),
  ];
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
      <header className="flex h-16 items-center justify-between border-b bg-white px-5 lg:hidden">
        <Link to="/customers">
          <Brand />
        </Link>
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
          className="fixed inset-0 top-16 z-20 bg-black/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r bg-white p-4 max-lg:top-16 max-lg:transition-transform',
          !menuOpen && 'max-lg:invisible max-lg:-translate-x-full',
        )}
      >
        <Link
          to="/customers"
          aria-label="FieldDesk CRM home"
          className="mb-9 px-2 pt-3 max-lg:hidden"
        >
          <Brand />
        </Link>
        <p className="mb-3 px-3 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          CRM
        </p>
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              to={to}
              key={to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                  isActive && 'bg-blue-50 font-medium text-primary',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t pt-4">
          {error && <ErrorNotice message={error} />}
          <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
            <Button
              aria-label="Sign out"
              title="Sign out"
              variant="ghost"
              size="icon"
              disabled={pending}
              onClick={() => void logout()}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </aside>
      <div className="lg:pl-56">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-3 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>CRM</span>
            <ChevronRight className="size-3" />
            <span className="text-foreground">{title}</span>
          </div>
          {user.role === 'ADMIN' && data ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor="acting-staff"
                className="text-xs text-muted-foreground"
              >
                Working as
              </label>
              <NativeSelect
                id="acting-staff"
                aria-label="Working as"
                className="h-8 max-w-56 bg-white text-xs"
                value={actor.id}
                onChange={(event) =>
                  useCrmStore.getState().selectActor(event.target.value)
                }
              >
                {data.actors.map((row) => (
                  <option value={row.id} key={row.id}>
                    {row.name} · {ROLE_LABELS[row.role]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </span>
          )}
        </div>
        <main id="main" className="mx-auto max-w-[1440px] p-5 lg:p-8">
          {notice && (
            <div
              role="status"
              className="mb-5 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {notice}
              <Button
                aria-label="Dismiss notification"
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => notify('')}
              >
                <X />
              </Button>
            </div>
          )}
          {crmError && (
            <div className="mb-5">
              <ErrorNotice message={crmError} />
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
