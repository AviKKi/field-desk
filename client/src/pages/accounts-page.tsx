import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerAccountRow } from '@crm/shared/crm';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Loading } from '@/components/feedback';
import { useCrm, useRecord } from '@/features/crm/context';
import {
  Empty,
  money,
  PageHeader,
  Pager,
  SearchInput,
  Table,
  useTablePage,
} from '@/features/crm/ui';
export function AccountsPage() {
  const { refresh } = useCrm();
  const { data, error } = useRecord<CustomerAccountRow[]>('/crm/accounts');
  const [search, setSearch] = useState('');
  const accounts = (data ?? []).filter((row) =>
    `${row.customer.name} ${row.customer.code}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const page = useTablePage(accounts, search);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer accounts"
        description="Review outstanding balances, payments, and customer credit."
      >
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </PageHeader>
      {error ? (
        <ErrorNotice message={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b p-5">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search customer accounts…"
            />
          </div>
          {accounts.length ? (
            <Table
              columns={[
                'Customer',
                'Code',
                'Outstanding',
                'Unapplied cash',
                'Open credits',
                'Net balance',
                '',
              ]}
            >
              {page.rows.map((row) => (
                <tr key={row.customer.id}>
                  <td>
                    <Link
                      className="font-medium text-primary hover:underline"
                      to={`/customers/${row.customer.id}?tab=account`}
                    >
                      {row.customer.name}
                    </Link>
                  </td>
                  <td>{row.customer.code}</td>
                  <td>{money(row.outstandingPaise)}</td>
                  <td>{money(row.unappliedCashPaise)}</td>
                  <td>{money(row.creditsOpenPaise)}</td>
                  <td className="font-medium">{money(row.netBalancePaise)}</td>
                  <td>
                    <Link
                      className="whitespace-nowrap text-primary hover:underline"
                      to={`/customers/${row.customer.id}?tab=account`}
                    >
                      View account
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No customer accounts found" />
          )}
          <Pager
            page={page.page}
            count={accounts.length}
            onPage={page.setPage}
          />
        </Card>
      )}
    </div>
  );
}
