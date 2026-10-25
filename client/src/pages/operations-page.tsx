import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Package,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Download,
  Wallet,
  ShoppingBag,
} from 'lucide-react';
import { SCENARIOS, crmActionSchema } from '@crm/shared/crm';
import type {
  ActionEnvelope,
  ActionResult,
  CommandType,
  CrmBootstrap,
  CustomerSummary,
  LedgerView,
  OrderDetail,
  ScenarioReport,
} from '@crm/shared/crm';
import type { Role } from '@crm/shared';
import { ROLE_LABELS } from '@crm/shared/roles';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import { useCrmStore } from '@/store/crm-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ErrorNotice, Loading } from '@/components/feedback';

const OPERATIONS: Array<{ type: CommandType; label: string; roles: Role[] }> = [
  { type: 'PUNCH_ORDER', label: 'Create order', roles: ['SALES'] },
  { type: 'EDIT_ORDER', label: 'Revise order', roles: ['SALES'] },
  { type: 'SUBMIT_ORDER', label: 'Submit for approval', roles: ['SALES'] },
  { type: 'APPROVE_ORDER', label: 'Approve revision', roles: ['KAM'] },
  { type: 'REJECT_ORDER', label: 'Reject revision', roles: ['KAM'] },
  { type: 'START_LOADING', label: 'Start loading', roles: ['WAREHOUSE'] },
  {
    type: 'DISPATCH_SHIPMENT',
    label: 'Dispatch shipment',
    roles: ['WAREHOUSE'],
  },
  { type: 'CONFIRM_DELIVERY', label: 'Confirm delivery', roles: ['WAREHOUSE'] },
  {
    type: 'CANCEL_REMAINDER',
    label: 'Cancel unshipped units',
    roles: ['SALES'],
  },
  {
    type: 'RECORD_RETURN',
    label: 'Receive returned goods',
    roles: ['WAREHOUSE'],
  },
  {
    type: 'RECEIVE_CUSTOMER_PAYMENT',
    label: 'Record customer payment',
    roles: ['ACCOUNTS'],
  },
  {
    type: 'ALLOCATE_PAYMENT',
    label: 'Allocate unapplied cash',
    roles: ['ACCOUNTS'],
  },
  {
    type: 'REDEEM_POINTS',
    label: 'Redeem points',
    roles: ['SALES', 'ACCOUNTS'],
  },
  {
    type: 'ISSUE_CREDIT_NOTE',
    label: 'Reserve customer credit',
    roles: ['ACCOUNTS'],
  },
  {
    type: 'APPLY_CREDIT_NOTE',
    label: 'Apply customer credit',
    roles: ['ACCOUNTS'],
  },
  {
    type: 'REFUND_CREDIT_NOTE',
    label: 'Record credit refund',
    roles: ['ACCOUNTS'],
  },
  {
    type: 'CORRECT_DISPATCHED_ORDER',
    label: 'Record shipment correction',
    roles: ['KAM'],
  },
];
const ACCOUNT_OPERATIONS = [
  'RECEIVE_CUSTOMER_PAYMENT',
  'ALLOCATE_PAYMENT',
  'REDEEM_POINTS',
  'ISSUE_CREDIT_NOTE',
  'APPLY_CREDIT_NOTE',
  'REFUND_CREDIT_NOTE',
];
export function money(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(paise / 100);
}
function paise(value: FormDataEntryValue | null): number {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error('Enter an amount with up to two decimal places');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large');
  return result;
}
function Field({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Badge
      className={
        value === 'APPLIED'
          ? 'bg-secondary text-primary'
          : value === 'REJECTED' || value === 'CONFLICT'
            ? 'bg-destructive/10 text-destructive'
            : ''
      }
    >
      {value.replaceAll('_', ' ')}
    </Badge>
  );
}
function Records({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length)
    return <p className="p-4 text-sm text-muted-foreground">No entries yet.</p>;
  return (
    <div className="max-h-96 space-y-2 overflow-auto">
      {rows.map((row, index) => (
        <details
          className="rounded-lg border bg-card text-xs"
          key={String(row.id ?? index)}
        >
          <summary className="cursor-pointer p-3">
            <span className="mr-3 font-medium">
              {String(
                row.kind ??
                  row.bucket ??
                  row.reference ??
                  row.type ??
                  'Posting',
              ).replaceAll('_', ' ')}
            </span>
            {'amount_paise' in row
              ? money(Number(row.amount_paise))
              : 'points_delta' in row
                ? `${Number(row.points_delta).toLocaleString()} points`
                : ''}
            <span className="ml-3 text-muted-foreground">
              {String(row.created_at ?? '')
                .replace('T', ' ')
                .slice(0, 19)}
            </span>
          </summary>
          <pre className="overflow-x-auto border-t p-3 text-[11px]">
            {JSON.stringify(row, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}

export function OperationsPage() {
  const user = useAuthStore((state) => state.user)!;
  const selection = useCrmStore();
  const [bootstrap, setBootstrap] = useState<CrmBootstrap | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [report, setReport] = useState<ScenarioReport | null>(null);
  const [scenario, setScenario] = useState<string>(SCENARIOS[0][0]);
  const [customerDialog, setCustomerDialog] = useState(false);
  const [tab, setTab] = useState('order');
  const [shipmentId, setShipmentId] = useState('');
  const [location, setLocation] = useState('');
  const [correctionShipment, setCorrectionShipment] = useState('');
  const lastEnvelope = useRef<ActionEnvelope | null>(null);
  const customerId = bootstrap?.customers.some(
    (row) => row.id === selection.customerId,
  )
    ? selection.customerId
    : (bootstrap?.customers[0]?.id ?? '');
  const orders =
    bootstrap?.orders.filter((order) => order.customer_id === customerId) ?? [];
  const orderId = orders.some((order) => order.id === selection.orderId)
    ? selection.orderId
    : (orders[0]?.id ?? '');
  const actor =
    bootstrap?.actors.find((row) => row.id === selection.actorId) ??
    bootstrap?.actors.find((row) => row.id === user.id) ??
    user;
  const availableOperations = OPERATIONS.filter(
    (operation) =>
      actor.role === 'ADMIN' || operation.roles.includes(actor.role),
  );
  const operation = availableOperations.some(
    (row) => row.type === selection.operation,
  )
    ? selection.operation
    : (availableOperations[0]?.type ?? 'PUNCH_ORDER');
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api<CrmBootstrap>('/crm/bootstrap', { signal: controller.signal })
      .then(setBootstrap)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!customerId) {
      setSummary(null);
      setLedger(null);
      return;
    }
    const controller = new AbortController();
    setSummary(null);
    setLedger(null);
    void Promise.all([
      api<CustomerSummary>(`/crm/customers/${customerId}/summary`, {
        signal: controller.signal,
      }),
      api<LedgerView>(`/crm/customers/${customerId}/ledger`, {
        signal: controller.signal,
      }),
    ])
      .then(([value, entries]) => {
        setSummary(value);
        setLedger(entries);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [customerId, revision]);
  useEffect(() => {
    setDetail(null);
    if (!orderId) return;
    const controller = new AbortController();
    void api<OrderDetail>(`/crm/orders/${orderId}`, {
      signal: controller.signal,
    })
      .then(setDetail)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [orderId, revision]);
  const eligibleShipments =
    detail?.shipments.filter((shipment) =>
      operation === 'DISPATCH_SHIPMENT'
        ? shipment.status === 'LOADING'
        : shipment.status === 'DISPATCHED',
    ) ?? [];
  const shipment =
    eligibleShipments.find((row) => row.id === shipmentId) ??
    eligibleShipments[0];
  const needsItems = [
    'PUNCH_ORDER',
    'EDIT_ORDER',
    'CORRECT_DISPATCHED_ORDER',
  ].includes(operation);
  const needsReason = [
    'EDIT_ORDER',
    'REJECT_ORDER',
    'CANCEL_REMAINDER',
    'RECORD_RETURN',
    'ISSUE_CREDIT_NOTE',
    'CORRECT_DISPATCHED_ORDER',
  ].includes(operation);
  const accountOperation = ACCOUNT_OPERATIONS.includes(operation);

  async function send(envelope: ActionEnvelope) {
    setPending(true);
    setError('');
    try {
      lastEnvelope.current = envelope;
      const response = await api<ActionResult>('/crm/actions', {
        method: 'POST',
        body: JSON.stringify(envelope),
      });
      setResult(response);
      if (response.references.orderId)
        selection.selectOrder(response.references.orderId);
      refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary) return;
    try {
      const data = new FormData(event.currentTarget);
      const reason = String(data.get('reason') ?? '');
      const reference = String(data.get('reference') ?? '');
      let payload: Record<string, unknown> = accountOperation
        ? { customerId }
        : { orderId };
      if (operation === 'PUNCH_ORDER') payload = { customerId };
      if (needsReason) payload.reason = reason;
      if (needsItems) {
        payload.items = (bootstrap?.skus ?? [])
          .map((sku) => ({
            skuId: sku.id,
            qty: Number(data.get(`qty-${sku.id}`)),
            unitPricePaise: paise(data.get(`price-${sku.id}`)),
            ...(operation === 'CORRECT_DISPATCHED_ORDER'
              ? { deliveredQty: Number(data.get(`delivered-${sku.id}`)) }
              : {}),
          }))
          .filter((item) => item.qty > 0);
      }
      if (operation === 'APPROVE_ORDER' || operation === 'REJECT_ORDER')
        payload.revision = detail?.order.current_revision;
      if (operation === 'START_LOADING')
        payload.items = (detail?.lines ?? [])
          .map((line) => ({
            lineKey: line.lineKey,
            qty: Number(data.get(`load-${line.lineKey}`)),
          }))
          .filter((item) => item.qty > 0);
      if (operation === 'DISPATCH_SHIPMENT' || operation === 'CONFIRM_DELIVERY')
        payload.shipmentId = shipment?.id ?? '';
      if (operation === 'CONFIRM_DELIVERY')
        payload.items = (shipment?.lines ?? [])
          .map((line) => ({
            shipmentLineId: line.id,
            qty: Number(data.get(`deliver-${line.id}`)),
          }))
          .filter((item) => item.qty > 0);
      if (operation === 'RECORD_RETURN') {
        payload.items = (detail?.shipments ?? [])
          .flatMap((row) => row.lines)
          .map((line) => ({
            shipmentLineId: line.id,
            qty: Number(data.get(`return-${line.id}`)),
          }))
          .filter((item) => item.qty > 0);
        payload.feePaise = paise(data.get('fee'));
      }
      if (
        [
          'RECEIVE_CUSTOMER_PAYMENT',
          'ISSUE_CREDIT_NOTE',
          'APPLY_CREDIT_NOTE',
          'REFUND_CREDIT_NOTE',
        ].includes(operation)
      )
        payload.amountPaise = paise(data.get('amount'));
      if (
        operation === 'RECEIVE_CUSTOMER_PAYMENT' ||
        operation === 'REFUND_CREDIT_NOTE'
      )
        payload.reference = reference;
      if (operation === 'REDEEM_POINTS') {
        payload.chargeId = data.get('charge');
        payload.points = Number(data.get('points'));
      }
      if (operation === 'APPLY_CREDIT_NOTE')
        payload.chargeId = data.get('charge');
      if (
        operation === 'APPLY_CREDIT_NOTE' ||
        operation === 'REFUND_CREDIT_NOTE'
      )
        payload.creditNoteId = data.get('credit');
      if (operation === 'CORRECT_DISPATCHED_ORDER') {
        payload.evidence = data.get('evidence');
        payload.authorizationReference = data.get('authorization');
        if (location) payload.location = location;
        if (location === 'EXISTING_SHIPMENT' && correctionShipment)
          payload.shipmentId = correctionShipment;
        if (location === 'NEW_SHIPMENT' && data.get('dispatchedAt'))
          payload.dispatchedAt = new Date(
            String(data.get('dispatchedAt')),
          ).toISOString();
      }
      const command = crmActionSchema.parse({ type: operation, payload });
      void send({
        command,
        actorId: actor.id,
        idempotencyKey: crypto.randomUUID(),
        expectedVersion:
          accountOperation || operation === 'PUNCH_ORDER'
            ? summary.customer.version
            : detail?.order.version,
      });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function utility(kind: 'seed' | 'reset' | 'scenario') {
    if (
      kind === 'reset' &&
      !window.confirm(
        'Delete all CRM transactions and reload the sample customers? Staff accounts will be kept.',
      )
    )
      return;
    setPending(true);
    setError('');
    try {
      if (kind === 'scenario') {
        const value = await api<ScenarioReport>(
          `/crm/scenarios/${scenario}/run`,
          { method: 'POST' },
        );
        setReport(value);
        selection.selectCustomer(value.customerId);
        setResult(value.steps.at(-1)?.result ?? null);
      } else {
        await api<CrmBootstrap>(`/crm/${kind}`, {
          method: 'POST',
          ...(kind === 'reset'
            ? { body: JSON.stringify({ confirmation: 'RESET CRM DATA' }) }
            : {}),
        });
        if (kind === 'reset') {
          setResult(null);
          setReport(null);
          selection.selectCustomer('');
          lastEnvelope.current = null;
        }
      }
      refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  async function customerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const value = await api<{ id: string }>('/crm/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          code: data.get('code'),
        }),
      });
      selection.selectCustomer(value.id);
      setCustomerDialog(false);
      refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  function exportReport() {
    const blob = new Blob([JSON.stringify(report ?? result, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customer-activity.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!bootstrap) return error ? <ErrorNotice message={error} /> : <Loading />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Orders · Fulfillment · Customer accounts
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Operations desk
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Keep orders moving, accounts balanced, and every change on record.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={pending || loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
      <Card>
        <div className="flex flex-wrap items-end gap-4 p-5">
          <div className="min-w-44 flex-1">
            <Field label="Customer" name="customer">
              <NativeSelect
                id="customer"
                className="w-full"
                value={customerId}
                disabled={pending}
                onChange={(event) => {
                  selection.selectCustomer(event.target.value);
                  setResult(null);
                }}
              >
                <option value="" disabled>
                  Select a customer
                </option>
                {bootstrap.customers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="min-w-44 flex-1">
            <Field label="Order" name="order">
              <NativeSelect
                id="order"
                className="w-full"
                value={orderId}
                disabled={pending}
                onChange={(event) => selection.selectOrder(event.target.value)}
              >
                <option value="">Select an order</option>
                {orders.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.number} · {row.status.replaceAll('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {user.role === 'ADMIN' && (
            <div className="min-w-44 flex-1">
              <Field label="Staff member" name="actor">
                <NativeSelect
                  id="actor"
                  className="w-full"
                  value={actor.id}
                  disabled={pending}
                  onChange={(event) =>
                    selection.selectActor(event.target.value)
                  }
                >
                  {bootstrap.actors.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {ROLE_LABELS[row.role]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          {['ADMIN', 'SALES', 'ACCOUNTS'].includes(user.role) && (
            <Button
              variant="outline"
              onClick={() => setCustomerDialog(true)}
              disabled={pending}
            >
              <Plus />
              Customer
            </Button>
          )}
        </div>
      </Card>
      {user.role === 'ADMIN' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-card/60 p-4">
          <span className="mr-2 text-xs font-medium text-muted-foreground">
            Sample workflows
          </span>
          <NativeSelect
            aria-label="Sample workflow"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
            disabled={pending}
          >
            {SCENARIOS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            onClick={() => void utility('scenario')}
            disabled={pending}
          >
            <Play />
            Run workflow
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void utility('seed')}
              disabled={pending}
            >
              Load sample data
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void utility('reset')}
              disabled={pending}
            >
              <RotateCcw />
              Reset data
            </Button>
          </div>
        </div>
      )}
      {!customerId ? (
        <Card>
          <CardContent className="p-10 text-center">
            <ShoppingBag className="mx-auto mb-4 size-10 text-primary" />
            <h2 className="font-semibold">Your operations desk is ready.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {user.role === 'ADMIN'
                ? 'Load the sample data above, or add your first customer.'
                : 'Add a customer or ask your admin to load the catalog.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {summary ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  'Net account balance',
                  money(summary.netBalancePaise),
                  summary.netBalancePaise < 0
                    ? 'Credit in the customer’s favor'
                    : 'Positive means due from customer',
                ],
                [
                  'Outstanding charges',
                  money(summary.outstandingPaise),
                  `${money(summary.unappliedCashPaise)} unapplied cash`,
                ],
                [
                  'Open customer credit',
                  money(summary.creditsOpenPaise),
                  `${money(summary.receivedPaise)} total receipts`,
                ],
                [
                  'Available points',
                  summary.points.available.toLocaleString(),
                  `${summary.points.locked.toLocaleString()} locked · ${summary.points.clawbackPending.toLocaleString()} pending recovery`,
                ],
              ].map(([label, value, caption]) => (
                <Card key={label}>
                  <CardContent className="p-5">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight">
                      {value}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {caption}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Loading label="Loading account…" />
          )}
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(250px,0.9fr)_minmax(0,1.7fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="size-4 text-primary" />
                  New activity
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {actor.name} · {ROLE_LABELS[actor.role]}
                </p>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={submit}
                  key={`${operation}-${orderId}`}
                  className="space-y-4"
                >
                  <Field label="Operation" name="operation">
                    <NativeSelect
                      id="operation"
                      className="w-full"
                      value={operation}
                      disabled={pending}
                      onChange={(event) => {
                        selection.selectOperation(
                          event.target.value as CommandType,
                        );
                        setLocation('');
                        setCorrectionShipment('');
                      }}
                    >
                      {availableOperations.map((row) => (
                        <option key={row.type} value={row.type}>
                          {row.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {!accountOperation &&
                    operation !== 'PUNCH_ORDER' &&
                    !detail && (
                      <p className="text-xs text-muted-foreground">
                        Create or select an order first.
                      </p>
                    )}
                  {needsItems && (
                    <div className="space-y-3">
                      {bootstrap.skus.map((sku, index) => {
                        const line = detail?.lines.find(
                          (row) => row.skuId === sku.id,
                        );
                        return (
                          <div
                            key={sku.id}
                            className="rounded-lg border bg-background p-3"
                          >
                            <p className="mb-3 text-xs font-medium">
                              {sku.code} · {sku.name}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <Field label="Units" name={`qty-${sku.id}`}>
                                <Input
                                  id={`qty-${sku.id}`}
                                  name={`qty-${sku.id}`}
                                  type="number"
                                  min="0"
                                  max="10000"
                                  defaultValue={
                                    operation === 'EDIT_ORDER'
                                      ? (line?.qty ?? 0)
                                      : operation === 'PUNCH_ORDER' &&
                                          index === 0
                                        ? 1
                                        : 0
                                  }
                                />
                              </Field>
                              <Field
                                label="Unit price (₹)"
                                name={`price-${sku.id}`}
                              >
                                <Input
                                  id={`price-${sku.id}`}
                                  name={`price-${sku.id}`}
                                  inputMode="decimal"
                                  defaultValue={
                                    ((operation === 'EDIT_ORDER'
                                      ? line?.unitPricePaise
                                      : undefined) ?? sku.price_paise) / 100
                                  }
                                />
                              </Field>
                            </div>
                            {operation === 'CORRECT_DISPATCHED_ORDER' && (
                              <div className="mt-2">
                                <Field
                                  label="Already delivered units"
                                  name={`delivered-${sku.id}`}
                                >
                                  <Input
                                    id={`delivered-${sku.id}`}
                                    name={`delivered-${sku.id}`}
                                    type="number"
                                    min="0"
                                    defaultValue="0"
                                  />
                                </Field>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {operation === 'START_LOADING' &&
                    detail?.lines.map((line) => (
                      <Field
                        key={line.lineKey}
                        label={`${line.code} · ${line.open - line.loaded} available to load`}
                        name={`load-${line.lineKey}`}
                      >
                        <Input
                          id={`load-${line.lineKey}`}
                          name={`load-${line.lineKey}`}
                          type="number"
                          min="0"
                          defaultValue={Math.max(0, line.open - line.loaded)}
                          max={Math.max(0, line.open - line.loaded)}
                        />
                      </Field>
                    ))}
                  {['DISPATCH_SHIPMENT', 'CONFIRM_DELIVERY'].includes(
                    operation,
                  ) && (
                    <Field label="Shipment" name="shipment">
                      <NativeSelect
                        id="shipment"
                        className="w-full"
                        value={shipment?.id ?? ''}
                        onChange={(event) => setShipmentId(event.target.value)}
                      >
                        <option value="" disabled>
                          Select shipment
                        </option>
                        {eligibleShipments.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.id.slice(0, 8)} · {row.status}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  {operation === 'CONFIRM_DELIVERY' &&
                    shipment?.lines.map((line) => (
                      <Field
                        key={line.id}
                        label={`${bootstrap.skus.find((sku) => sku.id === line.sku_id)?.code} · ${line.dispatched_qty - line.delivered} not yet delivered`}
                        name={`deliver-${line.id}`}
                      >
                        <Input
                          id={`deliver-${line.id}`}
                          name={`deliver-${line.id}`}
                          type="number"
                          min="0"
                          max={line.dispatched_qty - line.delivered}
                          defaultValue={line.dispatched_qty - line.delivered}
                        />
                      </Field>
                    ))}
                  {operation === 'RECORD_RETURN' &&
                    detail?.shipments
                      .flatMap((row) => row.lines)
                      .filter((line) => line.delivered > line.returned)
                      .map((line) => (
                        <Field
                          key={line.id}
                          label={`${bootstrap.skus.find((sku) => sku.id === line.sku_id)?.code} · ${line.delivered - line.returned} returnable · ${line.id.slice(0, 6)}`}
                          name={`return-${line.id}`}
                        >
                          <Input
                            id={`return-${line.id}`}
                            name={`return-${line.id}`}
                            type="number"
                            min="0"
                            max={line.delivered - line.returned}
                            defaultValue="0"
                          />
                        </Field>
                      ))}
                  {operation === 'RECORD_RETURN' && (
                    <Field label="Return deduction (₹)" name="fee">
                      <Input
                        id="fee"
                        name="fee"
                        inputMode="decimal"
                        defaultValue="0"
                        required
                      />
                    </Field>
                  )}
                  {[
                    'RECEIVE_CUSTOMER_PAYMENT',
                    'ISSUE_CREDIT_NOTE',
                    'APPLY_CREDIT_NOTE',
                    'REFUND_CREDIT_NOTE',
                  ].includes(operation) && (
                    <Field label="Amount (₹)" name="amount">
                      <Input
                        id="amount"
                        name="amount"
                        inputMode="decimal"
                        placeholder="100.00"
                        required
                      />
                    </Field>
                  )}
                  {['RECEIVE_CUSTOMER_PAYMENT', 'REFUND_CREDIT_NOTE'].includes(
                    operation,
                  ) && (
                    <Field label="Bank / receipt reference" name="reference">
                      <Input
                        id="reference"
                        name="reference"
                        required
                        minLength={operation === 'REFUND_CREDIT_NOTE' ? 3 : 1}
                        maxLength={200}
                      />
                    </Field>
                  )}
                  {['REDEEM_POINTS', 'APPLY_CREDIT_NOTE'].includes(
                    operation,
                  ) && (
                    <Field label="Outstanding charge" name="charge">
                      <NativeSelect
                        id="charge"
                        name="charge"
                        className="w-full"
                        required
                      >
                        <option value="">Select a charge</option>
                        {summary?.charges
                          .filter((row) => row.outstandingPaise > 0)
                          .map((row) => (
                            <option key={row.id} value={row.id}>
                              {orders.find((order) => order.id === row.order_id)
                                ?.number ?? row.order_id.slice(0, 6)}{' '}
                              · {money(row.outstandingPaise)}
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                  )}
                  {operation === 'REDEEM_POINTS' && (
                    <>
                      <Field label="Points to redeem" name="points">
                        <Input
                          id="points"
                          name="points"
                          type="number"
                          min="1"
                          max={summary?.points.available ?? 0}
                          required
                        />
                      </Field>
                      <p className="text-xs text-muted-foreground">
                        One point offsets one paise of an outstanding charge.
                      </p>
                    </>
                  )}
                  {['APPLY_CREDIT_NOTE', 'REFUND_CREDIT_NOTE'].includes(
                    operation,
                  ) && (
                    <Field label="Open credit note" name="credit">
                      <NativeSelect
                        id="credit"
                        name="credit"
                        className="w-full"
                        required
                      >
                        <option value="">Select credit</option>
                        {summary?.credits
                          .filter((row) => row.availablePaise > 0)
                          .map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.id.slice(0, 8)} · {money(row.availablePaise)}
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                  )}
                  {needsReason && (
                    <Field label="Reason" name="reason">
                      <Input
                        id="reason"
                        name="reason"
                        required
                        minLength={3}
                        maxLength={1000}
                      />
                    </Field>
                  )}
                  {operation === 'CORRECT_DISPATCHED_ORDER' && (
                    <>
                      <Field label="Evidence" name="evidence">
                        <Input
                          id="evidence"
                          name="evidence"
                          required
                          minLength={8}
                          placeholder="Signed delivery confirmation"
                        />
                      </Field>
                      <Field
                        label="Authorization reference"
                        name="authorization"
                      >
                        <Input
                          id="authorization"
                          name="authorization"
                          required
                          minLength={3}
                        />
                      </Field>
                      <Field label="Physical dispatch" name="location">
                        <NativeSelect
                          id="location"
                          className="w-full"
                          value={location}
                          onChange={(event) => setLocation(event.target.value)}
                        >
                          <option value="">Ask for shipment details</option>
                          <option value="EXISTING_SHIPMENT">
                            Existing dispatch
                          </option>
                          <option value="NEW_SHIPMENT">
                            Separate shipment
                          </option>
                        </NativeSelect>
                      </Field>
                      {location === 'EXISTING_SHIPMENT' && (
                        <Field
                          label="Original shipment"
                          name="original-shipment"
                        >
                          <NativeSelect
                            id="original-shipment"
                            className="w-full"
                            value={correctionShipment}
                            onChange={(event) =>
                              setCorrectionShipment(event.target.value)
                            }
                          >
                            <option value="">Select a dispatch</option>
                            {detail?.shipments
                              .filter((row) => row.dispatched_at)
                              .map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.id.slice(0, 8)} ·{' '}
                                  {row.dispatched_at?.slice(0, 10)}
                                </option>
                              ))}
                          </NativeSelect>
                        </Field>
                      )}
                      {location === 'NEW_SHIPMENT' && (
                        <Field
                          label="Actual dispatch date and time"
                          name="dispatchedAt"
                        >
                          <Input
                            id="dispatchedAt"
                            name="dispatchedAt"
                            type="datetime-local"
                            required
                          />
                        </Field>
                      )}
                    </>
                  )}
                  {operation === 'RECEIVE_CUSTOMER_PAYMENT' && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      The receipt belongs to {summary?.customer.name}. Eligible
                      charges are settled in date order.
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      pending ||
                      !summary ||
                      (!accountOperation &&
                        operation !== 'PUNCH_ORDER' &&
                        !detail)
                    }
                  >
                    {pending ? 'Saving…' : 'Record activity'}
                    <ArrowRight />
                  </Button>
                </form>
              </CardContent>
            </Card>
            <div className="min-w-0 space-y-5">
              <Card>
                <div className="flex flex-wrap gap-1 border-b p-3">
                  {[
                    ['order', 'Order'],
                    ['shipments', 'Shipments'],
                    ['account', 'Account activity'],
                    ['history', 'History'],
                  ].map(([key, label]) => (
                    <Button
                      size="sm"
                      variant={tab === key ? 'default' : 'ghost'}
                      key={key}
                      onClick={() => setTab(key!)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <CardContent className="p-5">
                  {tab === 'order' &&
                    (detail ? (
                      <>
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="font-semibold">
                              {detail.order.number}
                            </h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Revision {detail.order.current_revision} · Version{' '}
                              {detail.order.version}
                            </p>
                          </div>
                          <Status value={detail.order.status} />
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b text-muted-foreground">
                              <tr>
                                {[
                                  'SKU',
                                  'Ordered',
                                  'Shipped',
                                  'Delivered',
                                  'Returned',
                                  'Canceled',
                                  'Open',
                                ].map((label) => (
                                  <th
                                    key={label}
                                    className="px-2 py-3 font-medium"
                                  >
                                    {label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lines.map((line) => (
                                <tr key={line.lineKey} className="border-b">
                                  <td className="px-2 py-3 font-medium">
                                    {line.code}
                                    <span className="mt-1 block text-[10px] text-muted-foreground">
                                      {money(line.unitPricePaise)}
                                    </span>
                                  </td>
                                  {[
                                    line.qty,
                                    line.dispatched,
                                    line.delivered,
                                    line.returned,
                                    line.canceled,
                                    line.open,
                                  ].map((value, index) => (
                                    <td key={index} className="px-2 py-3">
                                      {value}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                          Loading reserves units. Returns preserve delivery
                          history and do not reopen demand.
                        </p>
                      </>
                    ) : (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Select or create an order to see its lines.
                      </p>
                    ))}
                  {tab === 'shipments' && (
                    <div className="space-y-4">
                      {detail?.shipments.length ? (
                        detail.shipments.map((row) => (
                          <div className="rounded-lg border p-4" key={row.id}>
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-xs font-medium">
                                <Package className="size-4" />
                                {row.id.slice(0, 8)}
                              </span>
                              <Status value={row.status} />
                            </div>
                            <p className="mb-3 text-[11px] text-muted-foreground">
                              Revision {row.revision}
                              {row.original_shipment_id
                                ? ` · Supplement to ${row.original_shipment_id.slice(0, 8)}`
                                : ''}
                            </p>
                            {row.lines.map((line) => (
                              <p key={line.id} className="mt-2 text-xs">
                                {
                                  bootstrap.skus.find(
                                    (sku) => sku.id === line.sku_id,
                                  )?.code
                                }{' '}
                                · {line.loaded_qty} loaded ·{' '}
                                {line.dispatched_qty} dispatched ·{' '}
                                {line.delivered} delivered · {line.returned}{' '}
                                returned
                              </p>
                            ))}
                          </div>
                        ))
                      ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No shipments yet.
                        </p>
                      )}
                    </div>
                  )}
                  {tab === 'account' && ledger && (
                    <div className="space-y-5">
                      {[
                        ['Charges and adjustments', ledger.finance],
                        ['Customer receipts', ledger.receipts],
                        ['Cash allocations', ledger.allocations],
                        ['Credit applications', ledger.creditApplications],
                        ['Points entries', ledger.rewards],
                        ['Returns', ledger.returns],
                        ['Shipment corrections', ledger.corrections],
                      ].map(([title, rows]) => (
                        <section key={String(title)}>
                          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                            <Wallet className="size-4 text-primary" />
                            {String(title)}
                          </h3>
                          <Records
                            rows={rows as Array<Record<string, unknown>>}
                          />
                        </section>
                      ))}
                    </div>
                  )}
                  {tab === 'history' && (
                    <div className="space-y-5">
                      <h3 className="text-sm font-semibold">
                        Commercial revisions
                      </h3>
                      {detail?.revisions.map((row) => (
                        <details
                          key={row.id}
                          className="rounded-lg border p-3 text-xs"
                        >
                          <summary className="cursor-pointer">
                            Revision {row.revision} · {row.reason}
                          </summary>
                          <pre className="mt-3 overflow-auto text-[11px]">
                            {JSON.stringify(row, null, 2)}
                          </pre>
                        </details>
                      ))}
                      <h3 className="pt-2 text-sm font-semibold">
                        Activity timeline
                      </h3>
                      {detail?.timeline.length ? (
                        detail.timeline.map((event) => (
                          <button
                            className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:bg-accent"
                            key={event.id}
                            onClick={() => {
                              void api<ActionResult>(
                                `/crm/actions/${event.action_id}/trace`,
                              )
                                .then(setResult)
                                .catch((failure: unknown) =>
                                  setError(errorMessage(failure)),
                                );
                            }}
                          >
                            <Activity className="mt-0.5 size-4 shrink-0 text-primary" />
                            <span>
                              <span className="block text-xs font-medium">
                                {OPERATIONS.find(
                                  (operation) => operation.type === event.type,
                                )?.label ?? event.type}
                              </span>
                              <span className="mt-1 block text-[11px] text-muted-foreground">
                                {event.actor_name} ·{' '}
                                {new Date(event.occurred_at).toLocaleString()}
                              </span>
                            </span>
                            <ChevronRight className="ml-auto size-4" />
                          </button>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No order activity yet.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              {result && (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="size-4 text-primary" />
                        Activity details
                      </CardTitle>
                      <Status value={result.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {result.errors.map((issue) => (
                      <ErrorNotice key={issue.code} message={issue.message} />
                    ))}
                    {result.decisions.map((decision) => (
                      <div
                        key={decision.key}
                        className="rounded-lg border bg-secondary/30 p-4"
                      >
                        <p className="mb-3 text-sm font-medium">
                          {decision.prompt}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {decision.options.map((option) => (
                            <Button
                              key={option.id}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setLocation(
                                  option.id === 'NEW_SHIPMENT'
                                    ? 'NEW_SHIPMENT'
                                    : 'EXISTING_SHIPMENT',
                                );
                                setCorrectionShipment(
                                  option.id === 'NEW_SHIPMENT' ? '' : option.id,
                                );
                              }}
                            >
                              {option.label}
                            </Button>
                          ))}
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Select the physical dispatch, review the form, and
                          submit again.
                        </p>
                      </div>
                    ))}
                    {result.trace.map((entry, index) => (
                      <p
                        key={index}
                        className="text-xs leading-relaxed text-muted-foreground"
                      >
                        {entry.explanation}
                      </p>
                    ))}
                    <details className="rounded-lg border p-3 text-xs">
                      <summary className="cursor-pointer font-medium">
                        Recorded changes · {result.effects.length}
                      </summary>
                      <pre className="mt-3 max-h-96 overflow-auto text-[10px]">
                        {JSON.stringify(result.effects, null, 2)}
                      </pre>
                    </details>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !lastEnvelope.current}
                        onClick={() => {
                          if (lastEnvelope.current)
                            void send(lastEnvelope.current);
                        }}
                      >
                        <RotateCcw />
                        Retry request
                      </Button>
                      <Button size="sm" variant="ghost" onClick={exportReport}>
                        <Download />
                        Export activity
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
          {report && (
            <Card>
              <CardHeader>
                <CardTitle>Workflow activity</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {SCENARIOS.find(([id]) => id === report.id)?.[1]}
                </p>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {report.steps.map((step, index) => (
                    <li key={index}>
                      <button
                        className="flex w-full flex-wrap items-center gap-3 rounded-lg border p-3 text-left hover:bg-accent"
                        onClick={() => setResult(step.result)}
                      >
                        <span className="text-xs text-muted-foreground">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1 text-sm">{step.label}</span>
                        <Status value={step.result.status} />
                      </button>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Dialog open={customerDialog} onOpenChange={setCustomerDialog}>
        <DialogContent>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>
            Create a customer account for orders and receipts.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => void customerSubmit(event)}
          >
            <Field label="Customer name" name="name">
              <Input
                id="name"
                name="name"
                required
                minLength={2}
                maxLength={120}
              />
            </Field>
            <Field label="Customer code" name="code">
              <Input
                id="code"
                name="code"
                required
                minLength={2}
                maxLength={40}
              />
            </Field>
            <Button type="submit" disabled={pending}>
              Create customer
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
