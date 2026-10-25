import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Users } from 'lucide-react';
import { createUserSchema } from '@crm/shared/schemas';
import { ROLE_LABELS, ROLES } from '@crm/shared/roles';
import type {
  AuthResponse,
  Role,
  UpdateUserInput,
  User,
  UsersResponse,
} from '@crm/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorNotice, Loading } from '@/components/feedback';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';

function RoleOptions() {
  return ROLES.map((role) => (
    <option key={role} value={role}>
      {ROLE_LABELS[role]}
    </option>
  ));
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    const parsed = createUserSchema.safeParse(Object.fromEntries(data));
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('. '));
      return;
    }
    setPending(true);
    try {
      await api<AuthResponse>('/users', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onCreated();
      onOpenChange(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setError('');
          onOpenChange(value);
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Add a team member</DialogTitle>
        <DialogDescription>
          Create their account and choose the workspace they can access.
        </DialogDescription>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="new-name">Full name</Label>
            <Input
              id="new-name"
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-email">Work email</Label>
            <Input
              id="new-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              At least 12 characters. Share securely with your team member.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-role">Role</Label>
            <NativeSelect
              className="w-full"
              id="new-role"
              name="role"
              defaultValue="SALES"
              disabled={pending}
            >
              <RoleOptions />
            </NativeSelect>
          </div>
          {error && <ErrorNotice message={error} />}
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const currentUser = useAuthStore((state) => state.user);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<{
    user: User;
    input: UpdateUserInput;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<UsersResponse>(
      `/users?${new URLSearchParams({ search: query, page: String(page), pageSize: '10' })}`,
      { signal: controller.signal },
    )
      .then(setData)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, page, revision]);

  async function update() {
    if (!edit) return;
    setPendingId(edit.user.id);
    setError('');
    setSuccess('');
    try {
      await api<AuthResponse>(`/users/${edit.user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(edit.input),
      });
      setEdit(null);
      setSuccess(
        'Account updated. Existing sessions for this team member have been signed out.',
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(errorMessage(failure));
      setEdit(null);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            People & access
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Good work is a team effort.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Manage the people who make it happen, and the access they need.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Add member
        </Button>
      </div>
      {error && (
        <div className="space-y-3">
          <ErrorNotice message={error} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      )}
      {success && (
        <p
          role="status"
          className="rounded-lg border border-primary/15 bg-secondary p-3 text-sm text-primary"
        >
          {success}
        </p>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Team members</h2>
            {data && <Badge>{data.total}</Badge>}
          </div>
          <div className="relative w-full sm:max-w-64">
            <Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search team members"
              className="pl-9"
              placeholder="Search by name or email…"
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <Loading label="Loading your team…" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">
                    Team member
                  </th>
                  <th className="px-5 py-3 text-left font-medium">Role</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">
                    Account access
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-primary">
                          {user.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-medium">
                            {user.name}
                            {user.id === currentUser?.id && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <NativeSelect
                        aria-label={`Role for ${user.name}`}
                        value={user.role}
                        disabled={
                          user.id === currentUser?.id || pendingId !== null
                        }
                        onChange={(event) =>
                          setEdit({
                            user,
                            input: { role: event.target.value as Role },
                          })
                        }
                      >
                        <RoleOptions />
                      </NativeSelect>
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        className={
                          user.active
                            ? 'gap-1.5 bg-secondary text-primary'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {user.active && (
                          <span className="size-1.5 rounded-full bg-primary" />
                        )}
                        {user.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          user.id === currentUser?.id || pendingId !== null
                        }
                        onClick={() =>
                          setEdit({ user, input: { active: !user.active } })
                        }
                      >
                        {user.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!error && !data?.users.length && (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No team members match your search.
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t p-4 text-xs text-muted-foreground">
          <span>
            Page {page}
            {data
              ? ` of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`
              : ''}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={!data || page * data.pageSize >= data.total || loading}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Another admin must change your own role or account status. Changes to a
        member’s access sign them out.
      </p>
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setSuccess('Team member created.');
          setRevision((value) => value + 1);
        }}
      />
      <Dialog
        open={edit !== null}
        onOpenChange={(value) => {
          if (!value && !pendingId) setEdit(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Update account access?</DialogTitle>
          <DialogDescription>
            {edit?.input.role
              ? `Change ${edit.user.name}’s role to ${ROLE_LABELS[edit.input.role]}?`
              : `${edit?.input.active ? 'Activate' : 'Deactivate'} ${edit?.user.name}’s account?`}{' '}
            Their existing sessions will be signed out.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={pendingId !== null}
              onClick={() => setEdit(null)}
            >
              Cancel
            </Button>
            <Button disabled={pendingId !== null} onClick={() => void update()}>
              {pendingId ? 'Updating…' : 'Confirm change'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
