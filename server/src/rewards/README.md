# Rewards

Owns reward entitlement, point ledger buckets, redemption records, and recovery of entitlement that has already been spent.

## Implementation

- [rewards.model.ts](rewards.model.ts): Redemption and reward ledger tables; retained entitlement and exact proportional rounding.
- [rewards.repository.ts](rewards.repository.ts): Typed reward postings, redemption persistence, and bucket/line/charge totals.
- [rewards.service.ts](rewards.service.ts): Redeem points, refresh entitlement, expose shared point balances, and return reward history.
- [rewards.controller.ts](rewards.controller.ts): Authenticated customer reward reads.

## Coordination

Orders, Fulfillment, and Accounts call `refresh` when approval, delivery, or cash attribution changes; Returns also refreshes after adjustments. The service reads commercial lines, returned quantities, and qualifying cash from their owners. Accounts uses `balances` for its summary instead of reconstructing point buckets separately. Commands use the Actions transaction and retain compensating postings when entitlement changes.

## Related

- [Backend module index](../README.md)
