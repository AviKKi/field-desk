import { useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { FormEvent } from 'react';
import { Plus, Pencil, ShoppingBag, ArrowUpRight } from 'lucide-react';
import type { Customer, CustomerSnapshot } from '@crm/shared/crm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorNotice, Loading } from '@/components/feedback';
import { api, errorMessage } from '@/lib/api';
import { useCommand, useCrm, useRecord } from '@/features/crm/context';
import {
  ActivityList,
  Empty,
  Field,
  Metric,
  money,
  OrdersTable,
  PageHeader,
  Pager,
  SearchInput,
  Table,
  Tabs,
  useTablePage,
  WorkspaceState,
} from '@/features/crm/ui';
import { AccountPanel } from '@/features/crm/account-panel';
import { ActivityDialog } from '@/features/crm/activity-dialog';

export function CustomersPage() {
  const { data, actor } = useCrm();
  const [search, setSearch] = useState('');
  const customers = (data?.customers ?? []).filter((customer) =>
    `${customer.name} ${customer.code}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const page = useTablePage(customers, search);
  const canCreate = ['ADMIN', 'SALES', 'ACCOUNTS'].includes(actor.role);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Customer accounts and their sales orders."
      >
        {canCreate && (
          <Button asChild>
            <Link to="/customers/new">
              <Plus />
              New customer
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
              placeholder="Search customers…"
            />
            <span className="text-sm text-muted-foreground">
              {customers.length} customers
            </span>
          </div>
          {customers.length ? (
            <Table columns={['Customer', 'Customer code', 'Orders', '']}>
              {page.rows.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <Link
                      to={`/customers/${customer.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {customer.name}
                    </Link>
                  </td>
                  <td>{customer.code}</td>
                  <td>
                    {data?.orders.filter(
                      (order) => order.customer_id === customer.id,
                    ).length ?? 0}
                  </td>
                  <td className="text-right">
                    <Link
                      to={`/customers/${customer.id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      View customer
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty
              title={search ? 'No matching customers' : 'No customers yet'}
              description={
                search
                  ? 'Try another customer name or code.'
                  : 'Create a customer account to start taking orders.'
              }
            >
              {canCreate && !search && (
                <Button asChild>
                  <Link to="/customers/new">
                    <Plus />
                    New customer
                  </Link>
                </Button>
              )}
            </Empty>
          )}
          <Pager
            page={page.page}
            count={customers.length}
            onPage={page.setPage}
          />
        </Card>
      </WorkspaceState>
    </div>
  );
}

export function CustomerFormPage() {
  const { id } = useParams();
  const { data, actor, refresh, notify } = useCrm();
  const navigate = useNavigate();
  const record = useRecord<CustomerSnapshot>(
    id ? `/crm/customers/${id}/snapshot` : '',
  );
  const command = useCommand();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const customer = id ? record.data?.summary.customer : undefined;
  const allowed = ['ADMIN', 'SALES', 'ACCOUNTS'].includes(actor.role);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get('name')).trim(),
      code: String(form.get('code')).trim(),
    };
    setPending(true);
    try {
      if (customer) {
        const result = await command.execute(
          {
            type: 'UPDATE_CUSTOMER',
            payload: { customerId: customer.id, ...input },
          },
          customer.version,
          'Customer updated.',
        );
        if (result) navigate(`/customers/${customer.id}`);
      } else {
        const created = await api<Customer>('/crm/customers', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        refresh();
        notify('Customer created.');
        navigate(`/customers/${created.id}`);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }
  if (!allowed)
    return <Empty title="You do not have permission to manage customers" />;
  if (!data || (id && !record.data && !record.error)) return <Loading />;
  if (id && record.error) return <ErrorNotice message={record.error} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title={id ? 'Edit customer' : 'New customer'}
        description="Enter the customer name and a unique account code."
        back={{
          to: id ? `/customers/${id}` : '/customers',
          label: id ? 'Back to customer' : 'Customers',
        }}
      />
      <Card className="max-w-2xl">
        <form key={id ?? 'new'} onSubmit={(event) => void submit(event)}>
          <div className="space-y-5 p-6">
            <h2 className="font-semibold">Customer information</h2>
            <Field name="name" label="Customer name">
              <Input
                id="name"
                name="name"
                autoComplete="organization"
                placeholder="e.g. Northside Stores"
                defaultValue={customer?.name}
                minLength={2}
                maxLength={120}
                required
              />
            </Field>
            <Field
              name="code"
              label="Customer code"
              hint="Use a unique code to identify this account."
            >
              <Input
                id="code"
                name="code"
                placeholder="e.g. NORTH-001"
                defaultValue={customer?.code}
                minLength={2}
                maxLength={40}
                required
              />
            </Field>
            {(error || command.error) && (
              <ErrorNotice message={error || command.error} />
            )}
          </div>
          <div className="flex justify-end gap-3 border-t bg-muted/30 px-6 py-4">
            <Button asChild variant="outline">
              <Link to={id ? `/customers/${id}` : '/customers'}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending || command.pending}>
              {pending ? 'Saving…' : id ? 'Save changes' : 'Create customer'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { actor } = useCrm();
  const { data, error, loading } = useRecord<CustomerSnapshot>(
    `/crm/customers/${id}/snapshot`,
  );
  const [params, setParams] = useSearchParams();
  const tab = ['orders', 'account', 'rewards', 'activity'].includes(
    params.get('tab') ?? '',
  )
    ? params.get('tab')!
    : 'orders';
  const setTab = (value: string) =>
    setParams({ tab: value }, { replace: true });
  const [paymentOpen, setPaymentOpen] = useState(false);
  if (error) return <ErrorNotice message={error} />;
  if (!data)
    return (
      <Loading label={loading ? 'Loading customer…' : 'Customer not found'} />
    );
  const summary = data.summary;
  const customer = summary.customer;
  const manage = ['ADMIN', 'SALES', 'ACCOUNTS'].includes(actor.role);
  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`Customer code: ${customer.code}`}
        back={{ to: '/customers', label: 'Customers' }}
      >
        {manage && (
          <Button asChild variant="outline">
            <Link to={`/customers/${id}/edit`}>
              <Pencil />
              Edit customer
            </Link>
          </Button>
        )}
        {['ADMIN', 'ACCOUNTS'].includes(actor.role) && (
          <Button variant="outline" onClick={() => setPaymentOpen(true)}>
            Record payment
          </Button>
        )}
        {['ADMIN', 'SALES'].includes(actor.role) && (
          <Button asChild>
            <Link to={`/orders/new?customer=${id}`}>
              <Plus />
              New order
            </Link>
          </Button>
        )}
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Outstanding" value={money(summary.outstandingPaise)} />
        <Metric
          label="Unapplied cash"
          value={money(summary.unappliedCashPaise)}
        />
        <Metric label="Open credits" value={money(summary.creditsOpenPaise)} />
        <Metric
          label="Available points"
          value={summary.points.available.toLocaleString('en-IN')}
        />
      </div>
      <Card className="overflow-hidden">
        <Tabs
          items={[
            ['orders', 'Orders'],
            ['account', 'Payments & credits'],
            ['rewards', 'Rewards'],
            ['activity', 'Activity'],
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'orders' &&
          (data.orders.length ? (
            <OrdersTable orders={data.orders.map((record) => record.order)} />
          ) : (
            <Empty
              title="No orders yet"
              description="Create this customer's first sales order."
            >
              {['ADMIN', 'SALES'].includes(actor.role) && (
                <Button asChild>
                  <Link to={`/orders/new?customer=${id}`}>
                    <ShoppingBag />
                    Create order
                  </Link>
                </Button>
              )}
            </Empty>
          ))}
        {tab === 'account' && <AccountPanel snapshot={data} />}
        {tab === 'rewards' && <AccountPanel snapshot={data} rewards />}
        {tab === 'activity' && <ActivityList events={data.timeline} />}
      </Card>
      {paymentOpen && (
        <ActivityDialog
          type="RECEIVE_CUSTOMER_PAYMENT"
          snapshot={data}
          onClose={() => setPaymentOpen(false)}
        />
      )}
    </div>
  );
}
