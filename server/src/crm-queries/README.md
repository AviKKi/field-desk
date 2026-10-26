# CRM queries

Composes the two cross-domain responses used to initialize the CRM and display a complete customer record.

## Implementation

- [crm-queries.service.ts](crm-queries.service.ts): `bootstrap` combines customer, catalog, order, and staff reads; `snapshot` combines account, order, ledger, timeline, and review reads.
- [crm-queries.controller.ts](crm-queries.controller.ts): The existing `/api/crm/bootstrap` and `/api/crm/customers/:id/snapshot` routes.
- [crm-queries.module.ts](crm-queries.module.ts): Imports only the providers needed to compose those reads.

## Coordination

Each response is assembled within one SQLite read transaction. Admin bootstrap includes active staff; other roles receive only their own staff identity. This module has no tables, model aliases, repositories, mutation methods, or compatibility forwarding methods. Callers that need a single domain operation use its owning service or repository. `AppModule` imports the business modules directly.

## Related

- [Backend module index](../README.md)
