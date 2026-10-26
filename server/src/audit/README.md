# Audit

Owns business activity history, posting provenance, action traces, and account consistency review.

## Implementation

- [audit.model.ts](audit.model.ts): The `business_events` table and event record type.
- [audit.repository.ts](audit.repository.ts): Event persistence, customer/order timelines, and duplicate-event queries.
- [audit.service.ts](audit.service.ts): Effect enrichment, evidence references, consistency checks, timelines, and authorized trace retrieval.
- [audit.controller.ts](audit.controller.ts): Customer/order activity, account review, and action trace reads.

## Coordination

Actions appends the business event and calls `review` and `enrich` within the command transaction. Review reads quantities, approvals, finance, credit, and reward evidence from their owning modules; a failed check causes Actions to roll back the activity. Trace results come from saved action requests and are restricted to the requester, acting staff member, or Admin. Reviewing an account does not replay its activities or write replacement balances.

## Related

- [Backend module index](../README.md)
