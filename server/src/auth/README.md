# Authentication

Owns sign-in, registration, JWT verification, persisted sessions, and request authentication and role guards.

## Implementation

- [auth.model.ts](auth.model.ts): The `sessions` table and session type.
- [auth.repository.ts](auth.repository.ts): Session creation, expiry lookup, pruning, and revocation.
- [auth.service.ts](auth.service.ts): Credential verification, Sales registration, session issuance, authentication, and logout.
- [auth.controller.ts](auth.controller.ts): Credential endpoints, current-user reads, and session cookie responses.
- [auth.guards.ts](auth.guards.ts): Default authentication and explicit route-role checks.
- [auth.decorators.ts](auth.decorators.ts): Public-route metadata, role metadata, and the current-user decorator.
- [session-cookie.ts](session-cookie.ts): Cookie name and environment-sensitive cookie options.

## Coordination

Users owns account records and password hashing. Authentication reads the current active user and role for every valid JWT session. `AppModule` installs the guards globally. The controller sets an HttpOnly cookie; tokens are not exposed in response JSON. Origin checks and other shared HTTP middleware live in `configure-app.ts`, outside this module.

## Related

- [Backend module index](../README.md)
