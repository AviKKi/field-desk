# Customers

Owns customer identity, unique account codes, and customer record versions.

## Implementation

- [customers.model.ts](customers.model.ts): The `customers` table and inferred customer type.
- [customers.repository.ts](customers.repository.ts): Typed customer lookup, listing, uniqueness queries, insertion, and updates.
- [customers.service.ts](customers.service.ts): Authorized creation and identity updates, plus required-record lookup.
- [customers.controller.ts](customers.controller.ts): Customer creation validation and authenticated identity reads.

## Coordination

Creation inserts a customer at version zero inside its own transaction and uses the signed-in user. Identity edits use `UPDATE_CUSTOMER` through Actions, which handles expected versions, activity history, and version advancement. Orders, receipts, credits, and rewards belong to their respective modules and reference the customer ID. Customer creation does not create an order or initialize a stored account balance.

## Related

- [Backend module index](../README.md)
