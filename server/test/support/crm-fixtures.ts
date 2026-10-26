import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { User, Role } from '@crm/shared';
import type { ActionResult, CrmCommand } from '@crm/shared/crm';
import type { ActionsService } from '../../src/actions/actions.service.js';
import type { CustomersService } from '../../src/customers/customers.service.js';
import type { OrdersService } from '../../src/orders/orders.service.js';
import type { AccountsService } from '../../src/accounts/accounts.service.js';
import type { UsersRepository } from '../../src/users/users.repository.js';

type Fixture =
  | 'partial-delivery'
  | 'second-delivery'
  | 'customer-payment'
  | 'paid-return'
  | 'redemption'
  | 'credit-settlement'
  | 'shipment-correction';

interface FixtureDependencies {
  actions: ActionsService;
  customers: CustomersService;
  orders: OrdersService;
  accounts: AccountsService;
  users: UsersRepository;
}

export function createCrmFixture(
  { actions, customers, orders, accounts, users }: FixtureDependencies,
  admin: User,
  kind: Fixture,
) {
  const customer = customers.createCustomer(admin, {
    name: 'Integration customer',
    code: randomUUID(),
  });
  const customerId = customer.id;
  const actors = users.listActive();
  const steps: Array<{ label: string; result: ActionResult }> = [];
  function apply(
    command: CrmCommand,
    role: Role,
    expected: ActionResult['status'] = 'APPLIED',
  ) {
    const payload = command.payload;
    const result = actions.execute(
      {
        command,
        actorId: actors.find((actor) => actor.role === role)!.id,
        expectedVersion:
          'orderId' in payload
            ? orders.detail(payload.orderId).order.version
            : accounts.summary(customerId).customer.version,
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    assert.equal(result.status, expected, JSON.stringify(result.errors));
    steps.push({ label: command.type, result });
    return result;
  }
  function order(items = [{ skuId: 'sku-a', qty: 1, unitPricePaise: 10000 }]) {
    const created = apply(
      { type: 'PUNCH_ORDER', payload: { customerId, items } },
      'SALES',
    );
    const orderId = created.references.orderId!;
    apply({ type: 'SUBMIT_ORDER', payload: { orderId } }, 'SALES');
    apply({ type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } }, 'KAM');
    return orderId;
  }
  function ship(orderId: string, quantities?: number[]) {
    const detail = orders.detail(orderId);
    const loaded = apply(
      {
        type: 'START_LOADING',
        payload: {
          orderId,
          items: detail.lines
            .map((line, index) => ({
              lineKey: line.lineKey,
              qty: quantities?.[index] ?? line.open,
            }))
            .filter((line) => line.qty > 0),
        },
      },
      'WAREHOUSE',
    );
    const shipmentId = loaded.references.shipmentId!;
    apply(
      { type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } },
      'WAREHOUSE',
    );
    const lines = orders
      .detail(orderId)
      .shipments.find((row) => row.id === shipmentId)!.lines;
    apply(
      {
        type: 'CONFIRM_DELIVERY',
        payload: {
          orderId,
          shipmentId,
          items: lines.map((line) => ({
            shipmentLineId: line.id,
            qty: line.dispatched_qty,
          })),
        },
      },
      'WAREHOUSE',
    );
    return shipmentId;
  }
  function receive(amountPaise: number) {
    apply(
      {
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: { customerId, amountPaise, reference: 'Integration receipt' },
      },
      'ACCOUNTS',
    );
  }
  if (kind === 'partial-delivery' || kind === 'second-delivery') {
    const orderId = order([
      { skuId: 'sku-a', qty: 20, unitPricePaise: 10000 },
      { skuId: 'sku-b', qty: 15, unitPricePaise: 15000 },
    ]);
    ship(orderId, [10, 10]);
    if (kind === 'second-delivery') ship(orderId);
  } else if (kind === 'customer-payment') {
    ship(order());
    ship(order());
    receive(15000);
  } else {
    const first = order();
    const shipmentId = ship(first);
    if (kind === 'shipment-correction') {
      const payload = {
        orderId: first,
        items: [
          { skuId: 'sku-c', qty: 1, unitPricePaise: 25000, deliveredQty: 1 },
        ],
        reason: 'Extra cartons confirmed by the customer',
        evidence: 'Signed supplemental dispatch confirmation',
        authorizationReference: 'KAM-CORRECTION-001',
      };
      apply(
        { type: 'CORRECT_DISPATCHED_ORDER', payload },
        'KAM',
        'NEEDS_DECISION',
      );
      apply(
        {
          type: 'CORRECT_DISPATCHED_ORDER',
          payload: { ...payload, location: 'EXISTING_SHIPMENT', shipmentId },
        },
        'KAM',
      );
    } else {
      receive(10000);
      if (kind === 'redemption') {
        const second = order();
        ship(second);
        const charge = accounts
          .summary(customerId)
          .charges.find((row) => row.order_id === second)!;
        apply(
          {
            type: 'REDEEM_POINTS',
            payload: { customerId, chargeId: charge.id, points: 1000 },
          },
          'ACCOUNTS',
        );
      } else {
        const line = orders.detail(first).shipments[0]!.lines[0]!;
        const returned = apply(
          {
            type: 'RECORD_RETURN',
            payload: {
              orderId: first,
              items: [{ shipmentLineId: line.id, qty: 1 }],
              feePaise: 2000,
              reason: 'Returned goods with a deduction',
            },
          },
          'WAREHOUSE',
        );
        if (kind === 'credit-settlement') {
          const second = order();
          ship(second);
          const charge = accounts
            .summary(customerId)
            .charges.find((row) => row.order_id === second)!;
          apply(
            {
              type: 'APPLY_CREDIT_NOTE',
              payload: {
                customerId,
                creditNoteId: returned.references.creditNoteId!,
                chargeId: charge.id,
                amountPaise: 8000,
              },
            },
            'ACCOUNTS',
          );
        }
      }
    }
  }
  return { customerId, steps, summary: accounts.summary(customerId) };
}
