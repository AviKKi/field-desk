# Users

Owns staff accounts, password storage, account creation, searchable staff lists, and administrator-controlled role and status changes.

## Implementation

- [users.model.ts](users.model.ts): The `users` table, public column selection, and inferred account record type.
- [users.repository.ts](users.repository.ts): Typed account persistence, public projections, staff search, admin counts, and session revocation.
- [users.service.ts](users.service.ts): Create accounts, enforce admin-change restrictions, and coordinate session invalidation.
- [password.service.ts](password.service.ts): Salted scrypt hashing, verification, and dummy verification for unknown accounts.
- [users.controller.ts](users.controller.ts): Admin-only staff listing, creation, and role/status update endpoints.

## Coordination

Auth consumes account and password services but owns JWTs and sessions. Role and status updates revoke the target account sessions within the same transaction and protect the last active admin. Bootstrap and Actions read public account records from the repository. Public registration cannot select a role; Auth always requests Sales.

## Related

- [Backend module index](../README.md)
