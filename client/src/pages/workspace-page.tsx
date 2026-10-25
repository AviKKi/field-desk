import { useEffect, useState } from 'react';
import { BriefcaseBusiness, Users } from 'lucide-react';
import type { WorkspaceResponse } from '@crm/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice, Loading } from '@/components/feedback';
import { api, errorMessage } from '@/lib/api';

export function WorkspacePage({ area }: { area: 'sales' | 'accounts' }) {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [error, setError] = useState('');
  const Icon = area === 'sales' ? BriefcaseBusiness : Users;
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    void api<WorkspaceResponse>(`/workspace/${area}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [area]);
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-8">
      <div>
        <Badge className="mb-4">Your workspace</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{data.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{data.description}</p>
      </div>
      <Card>
        <CardHeader>
          <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-secondary text-primary">
            <Icon className="size-7" />
          </span>
          <CardTitle>Room for what comes next.</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            This workspace is set up and your access is confirmed. There are no
            business records yet. Sales and account modules can be built here as
            your workflows take shape.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
