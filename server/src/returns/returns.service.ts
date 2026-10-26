import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrdersRepository } from '../orders/orders.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { authorize, useOrder, fail, safe, distinct } from '../common/domain.js';

@Injectable()
export class ReturnsService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly returnsRepository: ReturnsRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
    private readonly accountsService: AccountsService,
    private readonly rewardsService: RewardsService,
    private readonly customersRepository: CustomersRepository,
  ) {}
  returnItems(c: Context, p: Payload<'RECORD_RETURN'>) {
    authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = useOrder(c, this.ordersRepository.findById(p.orderId));
    distinct(p.items.map((item) => item.shipmentLineId));
    const returned = p.items.map((item) => {
      const line = this.fulfillmentRepository.findInOrder(
        item.shipmentLineId,
        order.id,
      );
      if (!line) fail('LINE_NOT_FOUND', 'Select a line from this order');
      const delivered = this.fulfillmentRepository.deliveredForShipmentLine(
        line.id,
      );
      const prior = this.returnsRepository.returnedForShipmentLine(line.id);
      if (item.qty > delivered - prior)
        fail(
          'RETURN_EXCEEDED',
          'The return exceeds delivered, unreturned units',
        );
      return {
        line,
        qty: item.qty,
        amount: safe(item.qty * line.unit_price_paise),
      };
    });
    const gross = safe(returned.reduce((sum, item) => sum + item.amount, 0));
    if (p.feePaise > gross)
      fail(
        'FEE_EXCEEDED',
        'The deduction cannot exceed the returned goods value',
      );
    const returnId = randomUUID();
    c.references.returnId = returnId;
    this.returnsRepository.insertReturn(c, {
      id: returnId,
      customer_id: c.customerId,
      order_id: order.id,
      gross_paise: gross,
      fee_paise: p.feePaise,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });
    const released = new Map<string, number>();
    for (const { line, qty, amount } of returned) {
      this.returnsRepository.insertReturnLine(c, {
        id: randomUUID(),
        return_id: returnId,
        shipment_line_id: line.id,
        qty,
        amount_paise: amount,
      });
      let remaining = amount;
      for (const charge of this.accountsRepository.chargesForShipmentLine(
        line.id,
      )) {
        if (!remaining) break;
        const face =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const reduction = Math.min(face, remaining);
        if (!reduction) continue;
        this.accountsRepository.insertCharge(c, {
          id: randomUUID(),
          customer_id: c.customerId,
          order_id: order.id,
          line_key: line.line_key,
          shipment_line_id: line.id,
          kind: 'RETURN',
          amount_paise: -reduction,
          adjusts_id: charge.id,
          source_id: returnId,
          action_id: c.id,
          created_at: c.now,
        });
        remaining -= reduction;
        const cash = this.accountsRepository.cashForCharge(charge.id);
        const credits = this.creditsRepository.appliedToCharge(charge.id);
        const rewards = this.rewardsRepository.redeemedForCharge(charge.id);
        let overage = Math.max(
          0,
          cash + credits + rewards - (face - reduction),
        );
        for (const allocation of this.accountsRepository.cashByReceiptForCharge(
          charge.id,
        )) {
          const take = Math.min(overage, allocation.n);
          if (!take) continue;
          this.accountsRepository.insertAllocation(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: allocation.receipt_id,
            charge_id: charge.id,
            amount_paise: -take,
            action_id: c.id,
            created_at: c.now,
          });
          released.set(
            allocation.receipt_id,
            (released.get(allocation.receipt_id) ?? 0) + take,
          );
          overage -= take;
        }
        for (const application of this.creditsRepository.creditByNoteForCharge(
          charge.id,
        )) {
          const take = Math.min(overage, application.n);
          if (!take) continue;
          this.creditsRepository.insertApplication(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            credit_note_id: application.credit_note_id,
            charge_id: charge.id,
            amount_paise: -take,
            action_id: c.id,
            created_at: c.now,
          });
          overage -= take;
        }
        if (overage > 0) {
          if (overage > rewards)
            fail(
              'SETTLEMENT_MISMATCH',
              'The return cannot be settled against its source documents',
            );
          this.rewardsRepository.insertRedemption(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            charge_id: charge.id,
            points: -overage,
            action_id: c.id,
            created_at: c.now,
          });
          this.rewardsRepository.insertPosting(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: null,
            bucket: 'AVAILABLE',
            points_delta: overage,
            source_id: returnId,
            action_id: c.id,
            created_at: c.now,
          });
          this.rewardsRepository.insertPosting(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: null,
            bucket: 'REDEEMED',
            points_delta: -overage,
            source_id: returnId,
            action_id: c.id,
            created_at: c.now,
          });
        }
      }
      if (remaining)
        fail('CHARGE_MISMATCH', 'Delivered charges do not cover this return');
    }
    if (p.feePaise) {
      const feeId = randomUUID();
      let due = p.feePaise;
      this.accountsRepository.insertCharge(c, {
        id: feeId,
        customer_id: c.customerId,
        order_id: order.id,
        line_key: null,
        shipment_line_id: null,
        kind: 'RETURN_FEE',
        amount_paise: p.feePaise,
        adjusts_id: null,
        source_id: returnId,
        action_id: c.id,
        created_at: c.now,
      });
      for (const [receiptId, available] of released) {
        const take = Math.min(due, available);
        if (!take) continue;
        this.accountsRepository.insertAllocation(c, {
          id: randomUUID(),
          customer_id: c.customerId,
          receipt_id: receiptId,
          charge_id: feeId,
          amount_paise: take,
          action_id: c.id,
          created_at: c.now,
        });
        released.set(receiptId, available - take);
        due -= take;
      }
    }
    const credit = safe(
      [...released.values()].reduce((sum, value) => sum + value, 0),
    );
    if (credit) {
      const creditId = randomUUID();
      c.references.creditNoteId = creditId;
      this.creditsRepository.insertCredit(c, {
        id: creditId,
        customer_id: c.customerId,
        return_id: returnId,
        amount_paise: credit,
        reason: p.reason,
        action_id: c.id,
        created_at: c.now,
      });
      for (const [receiptId, amount] of released)
        if (amount)
          this.creditsRepository.insertFunding(c, {
            id: randomUUID(),
            credit_note_id: creditId,
            receipt_id: receiptId,
            amount_paise: amount,
          });
    }

    this.accountsService.allocateCash(c);

    this.rewardsService.refresh(c);
  }
  forCustomer(customerId: string) {
    if (!this.customersRepository.findById(customerId))
      throw new NotFoundException('Customer not found');
    return this.returnsRepository.forCustomer(customerId);
  }
}
