import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BriefcaseBusiness,
  Fingerprint,
  Layers3,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { canAccess, ROLE_LABELS } from '@crm/shared/roles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuthStore } from '@/store/auth-store';

const areas = [
  {
    key: 'sales',
    title: 'Sales workspace',
    description:
      'A dedicated space for your sales operations and the work ahead.',
    to: '/sales',
    icon: BriefcaseBusiness,
    number: '01',
  },
  {
    key: 'accounts',
    title: 'Key accounts',
    description:
      'Keep your key account work connected in a workspace of its own.',
    to: '/accounts',
    icon: Users,
    number: '02',
  },
  {
    key: 'users',
    title: 'Team management',
    description:
      'Bring people onboard and manage their roles and workspace access.',
    to: '/users',
    icon: ShieldCheck,
    number: '03',
  },
] as const;

export function OverviewPage() {
  const user = useAuthStore((state) => state.user);
  if (!user) return null;
  const available = areas.filter((area) => canAccess(user.role, area.key));
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Workspace overview
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          A good place to start, {user.name.split(' ')[0]}.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your team, your access, and your next step. All in one place.
        </p>
      </div>
      <section className="relative overflow-hidden rounded-2xl bg-[#142c28] p-7 text-white sm:p-9">
        <div className="absolute -top-16 -right-10 size-80 rounded-full border border-white/10" />
        <div className="absolute -top-6 right-0 size-60 rounded-full border border-white/10" />
        <div className="relative max-w-lg">
          <Badge className="mb-5 bg-white/10 text-emerald-200">
            Built around your role
          </Badge>
          <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
            Less friction.
            <br />
            More meaningful work.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            You’re signed in as {ROLE_LABELS[user.role]}. Your workspace is
            ready, with access to the areas that help you get things moving.
          </p>
          <Button
            asChild
            className="mt-6 bg-emerald-200 text-[#142c28] hover:bg-emerald-100"
          >
            <Link to={available[0]?.to ?? '/'}>
              Open workspace <ArrowRight />
            </Link>
          </Button>
        </div>
        <Layers3 className="absolute right-16 bottom-12 hidden size-28 -rotate-12 stroke-[0.7] text-emerald-200/35 xl:block" />
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label: 'Your role',
            value: ROLE_LABELS[user.role],
            caption: 'Assigned workspace access',
            icon: ShieldCheck,
          },
          {
            label: 'Available workspaces',
            value: String(available.length).padStart(2, '0'),
            caption: 'Connected to your role',
            icon: Layers3,
          },
          {
            label: 'Account status',
            value: 'Active',
            caption: 'You’re ready to get started',
            icon: Fingerprint,
          },
        ].map(({ label, value, caption, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between pb-4">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight">{value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Make your next move
          </h2>
          <span className="text-xs text-muted-foreground">Your workspaces</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {areas.map(({ key, title, description, to, icon: Icon, number }) => {
            const allowed = canAccess(user.role, key);
            return (
              <Card
                key={key}
                className={!allowed ? 'bg-muted/30 shadow-none' : ''}
              >
                <CardHeader>
                  <div className="mb-5 flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-xl border bg-card">
                      <Icon
                        className={`size-5 ${allowed ? 'text-primary' : 'text-muted-foreground'}`}
                      />
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      /{number}
                    </span>
                  </div>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription className="min-h-15 pt-1 leading-relaxed">
                    {description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {allowed ? (
                    <Link
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      to={to}
                    >
                      Open workspace <ArrowRight className="size-3.5" />
                    </Link>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {key === 'users'
                        ? 'Admin access required'
                        : `${key === 'sales' ? 'Sales' : 'KAM'} access required`}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
