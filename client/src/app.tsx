import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { canAccess } from '@crm/shared/roles';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/feedback';
const AuthPage = lazy(() =>
  import('@/pages/auth-page').then((module) => ({ default: module.AuthPage })),
);
const OperationsPage = lazy(() =>
  import('@/pages/operations-page').then((module) => ({
    default: module.OperationsPage,
  })),
);
const UsersPage = lazy(() =>
  import('@/pages/users-page').then((module) => ({
    default: module.UsersPage,
  })),
);
import { useAuthStore } from '@/store/auth-store';

function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  return status === 'authenticated' ? (
    <Outlet />
  ) : (
    <Navigate
      to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      replace
    />
  );
}
function RequireRole({
  area,
  children,
}: {
  area: 'users' | 'sales' | 'accounts';
  children: ReactNode;
}) {
  const user = useAuthStore((state) => state.user);
  return user && canAccess(user.role, area) ? (
    children
  ) : (
    <div className="space-y-4 py-16">
      <h1 className="text-2xl font-semibold">
        This area needs a different role.
      </h1>
      <p className="text-muted-foreground">
        Contact your admin if your work requires access to this workspace.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Back to overview</Link>
      </Button>
    </div>
  );
}
export function App() {
  const status = useAuthStore((state) => state.status);
  useEffect(() => {
    void useAuthStore.getState().initialize();
    const clear = () => useAuthStore.getState().clear();
    window.addEventListener('session-expired', clear);
    return () => window.removeEventListener('session-expired', clear);
  }, []);
  if (status === 'loading') return <Loading />;
  if (status === 'error')
    return (
      <div className="mx-auto max-w-md space-y-4 p-10">
        <h1 className="text-xl font-semibold">
          Couldn’t connect to your workspace.
        </h1>
        <p className="text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
        <Button onClick={() => void useAuthStore.getState().initialize()}>
          Try again
        </Button>
      </div>
    );
  return (
    <BrowserRouter>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-card focus:p-3"
      >
        Skip to content
      </a>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<OperationsPage />} />
              <Route
                path="users"
                element={
                  <RequireRole area="users">
                    <UsersPage />
                  </RequireRole>
                }
              />
              <Route
                path="sales"
                element={
                  <RequireRole area="sales">
                    <Navigate to="/" replace />
                  </RequireRole>
                }
              />
              <Route
                path="accounts"
                element={
                  <RequireRole area="accounts">
                    <Navigate to="/" replace />
                  </RequireRole>
                }
              />
              <Route
                path="*"
                element={
                  <div className="space-y-4 py-10">
                    <h1 className="text-2xl font-semibold">Page not found.</h1>
                    <Button asChild variant="outline">
                      <Link to="/">Back to overview</Link>
                    </Button>
                  </div>
                }
              />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
