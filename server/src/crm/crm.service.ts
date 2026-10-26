import { Injectable } from '@nestjs/common';
import type { User } from '@crm/shared';
import type { ActionEnvelope } from '@crm/shared/crm';
import type { CrmBootstrap, CustomerSnapshot } from './crm.model.js';
import { CrmRepository } from './crm.repository.js';
import { ActionsService } from '../actions/actions.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditService } from '../audit/audit.service.js';
@Injectable()
export class CrmService {
  constructor(
    private readonly repository: CrmRepository,
    private readonly actions: ActionsService,
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
    private readonly accountsService: AccountsService,
    private readonly audit: AuditService,
  ) {}
  execute(envelope: ActionEnvelope, user: User) {
    return this.actions.execute(envelope, user);
  }
  bootstrap(user: User): CrmBootstrap {
    return this.repository.read(() => ({
      ...this.repository.referenceData(user),
      orders: this.orders.list(),
    }));
  }
  createCustomer(user: User, input: { name: string; code: string }) {
    return this.customers.createCustomer(user, input);
  }
  detail(id: string) {
    return this.orders.detail(id);
  }
  summary(id: string) {
    return this.accountsService.summary(id);
  }
  accounts() {
    return this.accountsService.accounts();
  }
  ledger(id: string) {
    return this.accountsService.ledger(id);
  }
  review(id: string) {
    return this.audit.review(id);
  }
  customerTimeline(id: string) {
    return this.audit.customerTimeline(id);
  }
  trace(id: string, user: User) {
    return this.audit.trace(id, user);
  }
  snapshot(id: string): CustomerSnapshot {
    return this.repository.read(() => ({
      summary: this.summary(id),
      orders: this.orders.forCustomer(id),
      ledger: this.ledger(id),
      timeline: this.customerTimeline(id),
      review: this.review(id),
    }));
  }
}
