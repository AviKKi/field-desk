import { sql } from 'drizzle-orm';
import { seedReferenceData } from './seed-reference-data.js';
import type { User, Role } from '@crm/shared';
import type { CrmCommand, Customer } from '@crm/shared/crm';
import type { DatabaseService } from '../database/database.service.js';
import type { CrmService } from '../crm/crm.service.js';

export interface SeedSummary {
  customers: Array<{ id: string; code: string }>;
  orders: Array<{ id: string; customerId: string; description: string }>;
}
const datasetId = 'crm-local-v1';

export function seedDevelopmentData(
  database: DatabaseService,
  crm: CrmService,
  admin: User,
): SeedSummary & { alreadyPresent: boolean } {
  return database.db.transaction(
    () => {
      seedReferenceData(database, admin);
      const previous = database.db.get<{ summary: string }>(
        sql`select summary from seed_history where id=${datasetId}`,
      );
      if (previous)
        return {
          ...(JSON.parse(previous.summary) as SeedSummary),
          alreadyPresent: true,
        };
      const summary: SeedSummary = { customers: [], orders: [] };
      const actors = crm.bootstrap(admin).actors;
      const catalog = new Map(
        crm.bootstrap(admin).skus.map((sku) => [sku.id, sku]),
      );
      let position = 0;
      function apply(command: CrmCommand, role: Role) {
        const actor = actors.find((user) => user.role === role);
        if (!actor)
          throw new Error(
            `An active ${role} staff account is required to seed transactions.`,
          );
        const p = command.payload;
        const expectedVersion =
          'orderId' in p
            ? crm.detail(p.orderId).order.version
            : crm.summary(p.customerId).customer.version;
        const result = crm.execute(
          {
            command,
            actorId: actor.id,
            expectedVersion,
            idempotencyKey: `${datasetId}:${++position}`,
          },
          admin,
        );
        if (result.status !== 'APPLIED')
          throw new Error(
            `${command.type}: ${result.errors.map((issue) => issue.message).join('; ') || result.decisions.map((decision) => decision.prompt).join('; ')}`,
          );
        return result;
      }
      function customer(code: string, name: string) {
        const existing = database.db.get<Customer>(
          sql`select * from customers where code=${code}`,
        );
        const record = existing ?? crm.createCustomer(admin, { code, name });
        summary.customers.push({ id: record.id, code: record.code });
        return record.id;
      }
      function items(a: number, b = 0, c = 0) {
        return [a, b, c].flatMap((qty, index) => {
          if (!qty) return [];
          const sku = catalog.get(['sku-a', 'sku-b', 'sku-c'][index]!)!;
          return [{ skuId: sku.id, qty, unitPricePaise: sku.price_paise }];
        });
      }
      function order(
        customerId: string,
        description: string,
        quantities: [number, number?, number?],
        state: 'DRAFT' | 'PENDING' | 'APPROVED' = 'APPROVED',
      ) {
        const created = apply(
          {
            type: 'PUNCH_ORDER',
            payload: { customerId, items: items(...quantities) },
          },
          'SALES',
        );
        const orderId = created.references.orderId!;
        summary.orders.push({ id: orderId, customerId, description });
        if (state !== 'DRAFT')
          apply({ type: 'SUBMIT_ORDER', payload: { orderId } }, 'SALES');
        if (state === 'APPROVED')
          apply(
            { type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } },
            'KAM',
          );
        return orderId;
      }
      function load(orderId: string, quantities?: number[]) {
        const detail = crm.detail(orderId);
        return apply(
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
        ).references.shipmentId!;
      }
      function ship(
        orderId: string,
        quantities?: number[],
        delivered?: number[],
      ) {
        const shipmentId = load(orderId, quantities);
        apply(
          { type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } },
          'WAREHOUSE',
        );
        const shipment = crm
          .detail(orderId)
          .shipments.find((row) => row.id === shipmentId)!;
        const confirmations = shipment.lines
          .map((line, index) => ({
            shipmentLineId: line.id,
            qty: delivered?.[index] ?? line.dispatched_qty,
          }))
          .filter((line) => line.qty > 0);
        if (confirmations.length)
          apply(
            {
              type: 'CONFIRM_DELIVERY',
              payload: { orderId, shipmentId, items: confirmations },
            },
            'WAREHOUSE',
          );
        return crm
          .detail(orderId)
          .shipments.find((row) => row.id === shipmentId)!;
      }
      function receipt(
        customerId: string,
        amountPaise: number,
        reference: string,
      ) {
        return apply(
          {
            type: 'RECEIVE_CUSTOMER_PAYMENT',
            payload: { customerId, amountPaise, reference },
          },
          'ACCOUNTS',
        );
      }
      function payOrder(orderId: string, reference: string) {
        const detail = crm.detail(orderId);
        return receipt(
          detail.order.customer_id,
          detail.lines.reduce(
            (sum, line) => sum + line.qty * line.unitPricePaise,
            0,
          ),
          reference,
        );
      }
      function returned(orderId: string, qty: number, feePaise: number) {
        const line = crm.detail(orderId).shipments[0]!.lines[0]!;
        apply(
          {
            type: 'RECORD_RETURN',
            payload: {
              orderId,
              items: [{ shipmentLineId: line.id, qty }],
              feePaise,
              reason: 'Customer returned unopened cartons',
            },
          },
          'WAREHOUSE',
        );
      }
      const a = catalog.get('sku-a')!;

      const north = customer('NORTH-01', 'Northside Stores');
      order(north, 'Draft order', [5, 3], 'DRAFT');
      order(north, 'Awaiting KAM approval', [8, 4], 'PENDING');
      order(north, 'Approved, awaiting loading', [12, 5]);

      const river = customer('RIVER-02', 'Riverside Retail');
      load(order(river, 'Loading in progress', [16, 10]), [8, 5]);
      ship(
        order(river, 'Dispatched, awaiting delivery', [10, 6]),
        undefined,
        [0, 0],
      );
      ship(
        order(
          river,
          'Partially dispatched with no delivery confirmation',
          [12, 8],
        ),
        [5, 3],
        [0, 0],
      );
      const mixed = order(
        river,
        'Partial delivery with another batch loading',
        [20, 12],
      );
      ship(mixed, [8, 4], [4, 4]);
      load(mixed, [6, 4]);

      const central = customer('CENTRAL-03', 'Central Trading');
      ship(order(central, 'Delivered with an outstanding balance', [12, 8]));
      ship(
        order(
          central,
          'Partially dispatched and partially delivered',
          [10, 0, 4],
        ),
        [6, 2],
        [3, 1],
      );

      const hill = customer('HILL-04', 'Hillview Distributors');
      const rejected = order(
        hill,
        'Rejected commercial revision',
        [0, 5],
        'PENDING',
      );
      apply(
        {
          type: 'REJECT_ORDER',
          payload: {
            orderId: rejected,
            revision: 1,
            reason: 'Confirm the agreed quantities before approval',
          },
        },
        'KAM',
      );
      const revised = order(hill, 'Revised order awaiting reapproval', [8]);
      load(revised, [4]);
      apply(
        {
          type: 'EDIT_ORDER',
          payload: {
            orderId: revised,
            items: items(10, 0, 2),
            reason: 'Customer added reserve blend before dispatch',
          },
        },
        'SALES',
      );
      const canceled = order(hill, 'Canceled before dispatch', [4, 3]);
      apply(
        {
          type: 'CANCEL_REMAINDER',
          payload: {
            orderId: canceled,
            reason: 'Customer canceled before dispatch',
          },
        },
        'SALES',
      );
      const remainder = order(
        hill,
        'Delivered goods with canceled unshipped demand',
        [10, 5],
      );
      ship(remainder, [4, 2]);
      apply(
        {
          type: 'CANCEL_REMAINDER',
          payload: {
            orderId: remainder,
            reason: 'Customer canceled the outstanding remainder',
          },
        },
        'SALES',
      );

      const sunrise = customer('SUN-05', 'Sunrise Grocers');
      order(sunrise, 'Approved order covered by an unapplied advance', [10, 5]);
      receipt(sunrise, a.price_paise * 20, 'NEFT-SUN-ADVANCE-001');

      const green = customer('GREEN-06', 'Greenfield Wholesale');
      const paidReturn = order(
        green,
        'Paid delivery followed by a partial return',
        [10],
      );
      ship(paidReturn);
      payOrder(paidReturn, 'NEFT-GREEN-001');
      returned(paidReturn, 2, Math.min(2000, a.price_paise));
      ship(
        order(green, 'Later obligation with unapplied customer credit', [4, 2]),
      );

      const metro = customer('METRO-07', 'Metro Market');
      const creditSource = order(
        metro,
        'Paid goods returned with a deduction',
        [8],
      );
      ship(creditSource);
      payOrder(creditSource, 'UPI-METRO-001');
      returned(creditSource, 3, Math.min(3000, a.price_paise));
      const later = order(
        metro,
        'Partly settled using existing customer credit',
        [0, 6],
      );
      ship(later);
      let account = crm.summary(metro);
      const credit = account.credits[0]!;
      const charge = account.charges.find((row) => row.outstandingPaise > 0)!;
      const applicationAmount = Math.min(
        10000,
        credit.availablePaise,
        charge.outstandingPaise,
      );
      const application = apply(
        {
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId: metro,
            creditNoteId: credit.id,
            chargeId: charge.id,
            amountPaise: applicationAmount,
          },
        },
        'ACCOUNTS',
      );
      const applicationId = crm
        .ledger(metro)
        .creditApplications.find(
          (row) => row.action_id === application.actionId,
        )!.id as string;
      apply(
        {
          type: 'REVERSE_CREDIT_APPLICATION',
          payload: {
            customerId: metro,
            applicationId,
            amountPaise: Math.max(1, Math.floor(applicationAmount / 4)),
            reason: 'Corrected the amount applied to the later order',
          },
        },
        'ACCOUNTS',
      );
      account = crm.summary(metro);
      const refund = apply(
        {
          type: 'REFUND_CREDIT_NOTE',
          payload: {
            customerId: metro,
            creditNoteId: credit.id,
            amountPaise: Math.min(5000, account.credits[0]!.availablePaise),
            reference: 'NEFT-METRO-REFUND-001',
          },
        },
        'ACCOUNTS',
      );
      const refundRow = crm
        .ledger(metro)
        .refunds.find((row) => row.action_id === refund.actionId)!;
      apply(
        {
          type: 'REVERSE_CREDIT_REFUND',
          payload: {
            customerId: metro,
            refundId: String(refundRow.id),
            amountPaise: Math.max(
              1,
              Math.floor(Number(refundRow.amount_paise) / 5),
            ),
            reason: 'Part of the bank transfer was returned',
            reference: 'NEFT-METRO-RETURN-001',
          },
        },
        'ACCOUNTS',
      );

      const lake = customer('LAKE-08', 'Lakeside Foods');
      const earned = order(
        lake,
        'Paid source of subsequently redeemed points',
        [2],
      );
      ship(earned);
      payOrder(earned, 'NEFT-LAKE-001');
      ship(order(lake, 'Later delivery settled partly with points', [0, 2]));
      account = crm.summary(lake);
      const redeemCharge = account.charges.find(
        (row) => row.outstandingPaise > 0,
      )!;
      apply(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: lake,
            chargeId: redeemCharge.id,
            points: Math.min(
              1500,
              account.points.available,
              redeemCharge.outstandingPaise,
            ),
          },
        },
        'ACCOUNTS',
      );
      returned(earned, 2, 0);

      const valley = customer('VALLEY-09', 'Valley Retail');
      const corrected = order(
        valley,
        'Dispatched order with an authorized shipment supplement',
        [5],
      );
      const original = ship(corrected);
      const c = catalog.get('sku-c')!;
      apply(
        {
          type: 'CORRECT_DISPATCHED_ORDER',
          payload: {
            orderId: corrected,
            items: [
              {
                skuId: c.id,
                qty: 2,
                unitPricePaise: c.price_paise,
                deliveredQty: 1,
              },
            ],
            reason: 'Record extra cartons requested at dispatch',
            evidence: 'Signed dispatch supplement and customer confirmation',
            authorizationReference: 'KAM-VALLEY-001',
            location: 'EXISTING_SHIPMENT',
            shipmentId: original.id,
          },
        },
        'KAM',
      );
      const twoShipments = order(
        valley,
        'Completed across two physical shipments',
        [8, 6],
      );
      ship(twoShipments, [4, 3]);
      ship(twoShipments, [4, 3]);

      const oak = customer('OAK-10', 'Oakwood Stores');
      const paid = order(oak, 'Fully delivered and paid order', [10, 4]);
      ship(paid);
      payOrder(paid, 'NEFT-OAK-001');
      ship(order(oak, 'Partly paid with a points settlement', [0, 0, 2]));
      account = crm.summary(oak);
      const openCharge = account.charges.find(
        (row) => row.outstandingPaise > 0,
      )!;
      apply(
        {
          type: 'REDEEM_POINTS',
          payload: {
            customerId: oak,
            chargeId: openCharge.id,
            points: Math.min(
              1000,
              account.points.available,
              openCharge.outstandingPaise,
            ),
          },
        },
        'SALES',
      );
      receipt(oak, Math.max(1, Math.floor(c.price_paise / 2)), 'UPI-OAK-002');

      for (const customer of summary.customers) {
        const failed = crm
          .review(customer.id)
          .checks.filter((check) => !check.passed);
        if (failed.length)
          throw new Error(
            `Seeded account ${customer.code} is inconsistent: ${failed.map((check) => check.label).join(', ')}`,
          );
      }
      database.db.run(
        sql`insert into seed_history(id,summary,created_at) values (${datasetId},${JSON.stringify(summary)},${new Date().toISOString()})`,
      );
      return { ...summary, alreadyPresent: false };
    },
    { behavior: 'immediate' },
  );
}
