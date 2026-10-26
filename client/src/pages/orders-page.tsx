import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { OrderDetail } from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ErrorNotice, Loading } from '@/components/feedback';
import { useCommand, useCrm, useRecord } from '@/features/crm/context';
import {
  decimal,
  Empty,
  Field,
  money,
  OrdersTable,
  PageHeader,
  Pager,
  paise,
  SearchInput,
  StatusFilter,
  Table,
  useTablePage,
  WorkspaceState,
} from '@/features/crm/ui';

export function OrdersPage() {
  const { data, actor } = useCrm();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const orders = (data?.orders ?? []).filter(
    (row) =>
      (!status || row.status === status) &&
      `${row.number} ${data?.customers.find((customer) => customer.id === row.customer_id)?.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const page = useTablePage(orders, `${search}:${status}`);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales orders"
        description="Create and manage customer orders from draft to delivery."
      >
        {['ADMIN', 'SALES'].includes(actor.role) && (
          <Button asChild>
            <Link to="/orders/new">
              <Plus />
              New order
            </Link>
          </Button>
        )}
      </PageHeader>
      <WorkspaceState>
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search orders or customers…"
            />
            <StatusFilter value={status} onChange={setStatus} />
          </div>
          {orders.length ? (
            <OrdersTable orders={page.rows} />
          ) : (
            <Empty
              title={search || status ? 'No matching orders' : 'No orders yet'}
              description={
                search || status
                  ? 'Try another search or status.'
                  : 'Choose a customer and add products to create a sales order.'
              }
            >
              {['ADMIN', 'SALES'].includes(actor.role) &&
                !search &&
                !status && (
                  <Button asChild>
                    <Link to="/orders/new">
                      <Plus />
                      New order
                    </Link>
                  </Button>
                )}
            </Empty>
          )}
          <Pager page={page.page} count={orders.length} onPage={page.setPage} />
        </Card>
      </WorkspaceState>
    </div>
  );
}

interface DraftLine {
  key: string;
  skuId: string;
  qty: number;
  price: string;
}
export function OrderFormPage() {
  const { id } = useParams();
  const record = useRecord<OrderDetail>(id ? `/crm/orders/${id}` : '');
  const { data, actor } = useCrm();
  if (!data || (id && !record.data && !record.error))
    return <Loading label="Loading order form…" />;
  if (id && record.error) return <ErrorNotice message={record.error} />;
  if (!['ADMIN', 'SALES'].includes(actor.role))
    return <Empty title="You do not have permission to manage orders" />;
  const order = id ? record.data : null;
  if (
    order &&
    (order.shipments.some((shipment) => shipment.dispatched_at) ||
      order.order.status === 'CANCELLED')
  )
    return (
      <Empty
        title="This order cannot be edited"
        description="Dispatched orders use an authorized shipment correction."
      >
        <Button asChild variant="outline">
          <Link to={`/orders/${id}`}>Back to order</Link>
        </Button>
      </Empty>
    );
  return <OrderForm key={id ?? 'new'} detail={order} />;
}
function OrderForm({ detail }: { detail: OrderDetail | null }) {
  const { data } = useCrm();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const command = useCommand();
  const [customerId, setCustomerId] = useState(
    detail?.order.customer_id ?? params.get('customer') ?? '',
  );
  const initial = detail?.lines.map((line) => ({
    key: crypto.randomUUID(),
    skuId: line.skuId,
    qty: line.qty,
    price: decimal(line.unitPricePaise),
  }));
  const [lines, setLines] = useState<DraftLine[]>(
    initial ?? [{ key: crypto.randomUUID(), skuId: '', qty: 1, price: '' }],
  );
  const [error, setError] = useState('');
  const customer = data!.customers.find((row) => row.id === customerId);
  const hasProducts = Boolean(data?.skus.length);
  const total = lines.reduce((sum, line) => {
    try {
      return sum + paise(line.price) * line.qty;
    } catch {
      return sum;
    }
  }, 0);
  function update(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!customer) {
      setError('Select a customer.');
      return;
    }
    try {
      const items = lines.map((line) => ({
        skuId: line.skuId,
        qty: line.qty,
        unitPricePaise: paise(line.price),
      }));
      if (new Set(items.map((line) => line.skuId)).size !== items.length)
        throw new Error('Add each product only once.');
      const reason = String(
        new FormData(event.currentTarget).get('reason') ?? '',
      );
      const result = await command.execute(
        detail
          ? {
              type: 'EDIT_ORDER',
              payload: { orderId: detail.order.id, items, reason },
            }
          : { type: 'PUNCH_ORDER', payload: { customerId, items } },
        detail?.order.version ?? customer.version,
        detail
          ? 'Order updated. Submit the revised order for approval.'
          : 'Order created.',
      );
      if (result)
        navigate(`/orders/${detail?.order.id ?? result.references.orderId}`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Check the order details.',
      );
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={detail ? `Edit ${detail.order.number}` : 'New sales order'}
        description={
          detail
            ? 'Update the commercial order. Changes require approval again.'
            : 'Select a customer and add the products they want to order.'
        }
        back={{
          to: detail ? `/orders/${detail.order.id}` : '/orders',
          label: detail ? 'Back to order' : 'Sales orders',
        }}
      />
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <fieldset disabled={command.pending} className="space-y-5">
          <Card className="p-6">
            <h2 className="mb-5 font-semibold">Order information</h2>
            <div className="max-w-md">
              <Field name="customer" label="Customer">
                <NativeSelect
                  id="customer"
                  name="customer"
                  className="w-full bg-white"
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  required
                  disabled={Boolean(detail)}
                >
                  <option value="">Select a customer</option>
                  {data!.customers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.code}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!detail && (
                <Link
                  to="/customers/new"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-primary"
                >
                  <Plus className="size-3" />
                  Create a customer
                </Link>
              )}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold">Order items</h2>
            </div>
            {!hasProducts && (
              <div className="p-5">
                <ErrorNotice message="The product catalog is empty. Ask an administrator to add the local catalog before creating an order." />
              </div>
            )}
            <Table
              columns={['Product', 'Quantity', 'Unit price (₹)', 'Amount', '']}
            >
              {lines.map((line, index) => (
                <tr key={line.key}>
                  <td className="min-w-56">
                    <NativeSelect
                      className="w-full bg-white"
                      aria-label={`Product ${index + 1}`}
                      value={line.skuId}
                      required
                      onChange={(event) => {
                        const sku = data!.skus.find(
                          (row) => row.id === event.target.value,
                        );
                        update(line.key, {
                          skuId: event.target.value,
                          price: sku ? decimal(sku.price_paise) : '',
                        });
                      }}
                    >
                      <option value="">Select product</option>
                      {data!.skus.map((sku) => (
                        <option value={sku.id} key={sku.id}>
                          {sku.code} · {sku.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td>
                    <Input
                      className="w-24 bg-white"
                      aria-label={`Quantity ${index + 1}`}
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={line.qty || ''}
                      required
                      onChange={(event) =>
                        update(line.key, { qty: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <Input
                      className="w-32 bg-white"
                      aria-label={`Unit price ${index + 1}`}
                      inputMode="decimal"
                      value={line.price}
                      required
                      pattern="[0-9]+([.][0-9]{1,2})?"
                      onChange={(event) =>
                        update(line.key, { price: event.target.value })
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {(() => {
                      try {
                        return money(paise(line.price) * line.qty);
                      } catch {
                        return '—';
                      }
                    })()}
                  </td>
                  <td>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((row) => row.key !== line.key),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t p-5">
              <Button
                variant="outline"
                disabled={lines.length >= 100}
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { key: crypto.randomUUID(), skuId: '', qty: 1, price: '' },
                  ])
                }
              >
                <Plus />
                Add item
              </Button>
              <div className="flex items-center gap-8 text-sm">
                <span className="text-muted-foreground">Order total</span>
                <strong className="text-xl tabular-nums">{money(total)}</strong>
              </div>
            </div>
          </Card>
          {detail && (
            <Card className="p-6">
              <Field name="reason" label="Reason for changes">
                <Input
                  id="reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  placeholder="Explain the order changes"
                />
              </Field>
            </Card>
          )}
          {(error || command.error) && (
            <ErrorNotice message={error || command.error} />
          )}
          <div className="flex justify-end gap-3">
            <Button asChild variant="outline">
              <Link to={detail ? `/orders/${detail.order.id}` : '/orders'}>
                Cancel
              </Link>
            </Button>
            <Button type="submit" disabled={!hasProducts || command.pending}>
              {command.pending
                ? 'Saving…'
                : detail
                  ? 'Save changes'
                  : 'Create order'}
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
