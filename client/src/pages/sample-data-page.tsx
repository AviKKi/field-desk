import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SCENARIOS } from '@crm/shared/crm';
import type { SavedWorkflow, ScenarioReport } from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/feedback';
import { api, errorMessage } from '@/lib/api';
import { useCrm, useRecord } from '@/features/crm/context';
import { date, Empty, Field, PageHeader, Table } from '@/features/crm/ui';
export function SampleDataPage() {
  const { refresh, notify } = useCrm();
  const [params, setParams] = useSearchParams();
  const runId = params.get('workflow') ?? '';
  const saved = useRecord<SavedWorkflow[]>('/crm/samples');
  const report = useRecord<ScenarioReport>(
    runId ? `/crm/samples/${encodeURIComponent(runId)}` : '',
  );
  const [scenario, setScenario] = useState<string>(SCENARIOS[0][0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  async function activity(path: string, body: object, message: string) {
    setPending(true);
    setError('');
    try {
      const result = await api<ScenarioReport>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (result.runId) setParams({ workflow: result.runId });
      refresh();
      notify(message);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sample data"
        description="Administrator tools for preparing and reviewing local sample records."
      />
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-semibold">Catalog and sample accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Load products, sample customers, and staff desks. Existing
            transactions are retained.
          </p>
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            void activity('/crm/seed', {}, 'Sample catalog loaded.')
          }
        >
          Load sample catalog
        </Button>
      </Card>
      {(error || saved.error || report.error) && (
        <ErrorNotice message={error || saved.error || report.error} />
      )}
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Sample workflows</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field name="scenario" label="Workflow">
            <NativeSelect
              id="scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              {SCENARIOS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            disabled={pending}
            onClick={() =>
              void activity(
                '/crm/samples',
                { scenarioId: scenario },
                'Sample workflow created.',
              )
            }
          >
            Start workflow
          </Button>
        </div>
        {runId && report.data && (
          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {SCENARIOS.find(([id]) => id === report.data!.id)?.[1]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.data.steps.length} activities ·{' '}
                  {report.data.complete ? 'Complete' : 'In progress'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to={`/customers/${report.data.customerId}`}>
                    Open customer
                  </Link>
                </Button>
                <Button
                  disabled={pending || report.data.complete}
                  variant="outline"
                  onClick={() =>
                    void activity(
                      `/crm/samples/${runId}/step`,
                      {},
                      'Workflow advanced.',
                    )
                  }
                >
                  Next step
                </Button>
                <Button
                  disabled={pending || report.data.complete}
                  onClick={() =>
                    void activity(
                      `/crm/samples/${runId}/run`,
                      {},
                      'Workflow completed.',
                    )
                  }
                >
                  Run remaining steps
                </Button>
              </div>
            </div>
            {report.data.steps.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-lg border bg-white">
                <Table columns={['Step', 'Activity', 'Outcome']}>
                  {report.data.steps.map((step, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>
                        {step.label}
                        {step.result.errors.map((issue) => (
                          <p
                            key={issue.code}
                            className="mt-1 text-xs text-muted-foreground"
                          >
                            {issue.message}
                          </p>
                        ))}
                      </td>
                      <td className="capitalize">
                        {step.result.status.replaceAll('_', ' ').toLowerCase()}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b px-5 py-4 font-semibold">Saved workflows</div>
        {saved.data?.length ? (
          <Table columns={['Workflow', 'Customer', 'Created', 'Progress', '']}>
            {saved.data.map((run) => (
              <tr key={run.id}>
                <td>{SCENARIOS.find(([id]) => id === run.scenarioId)?.[1]}</td>
                <td>
                  <Link
                    className="text-primary hover:underline"
                    to={`/customers/${run.customerId}`}
                  >
                    {run.customerName}
                  </Link>
                </td>
                <td>{date(run.createdAt)}</td>
                <td>
                  {run.stepCount} activities ·{' '}
                  {run.complete ? 'Complete' : 'In progress'}
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setParams({ workflow: run.id })}
                  >
                    Open workflow
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No saved workflows" />
        )}
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-semibold">Reset local CRM data</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Delete customer transactions and workflow history. Staff accounts
            are retained.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => setResetOpen(true)}
        >
          Reset data…
        </Button>
      </Card>
      <Dialog
        open={resetOpen}
        onOpenChange={(value) => {
          if (!pending) setResetOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>Reset CRM data?</DialogTitle>
          <DialogDescription>
            All customer and transaction records will be deleted. This cannot be
            undone. Type RESET CRM DATA to confirm.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void activity(
                '/crm/reset',
                {
                  confirmation: String(
                    new FormData(event.currentTarget).get('confirmation'),
                  ),
                },
                'Local CRM data reset.',
              ).then((success) => {
                if (success) {
                  setParams({});
                  setResetOpen(false);
                }
              });
            }}
          >
            <Input
              aria-label="Reset confirmation"
              name="confirmation"
              required
              pattern="RESET CRM DATA"
              disabled={pending}
            />
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setResetOpen(false)}
              >
                Keep data
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                Reset data
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
