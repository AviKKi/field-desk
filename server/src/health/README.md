# Health

Exposes a public database readiness check.

## Implementation

- [health.service.ts](health.service.ts): Performs a minimal typed database read and returns the successful readiness response.
- [health.controller.ts](health.controller.ts): Marks `/api/health` as public and returns the service result.
- [health.module.ts](health.module.ts): Connects the controller and service to Database infrastructure.

## Coordination

The check requires an accessible, migrated database. It does not change data or disclose records. The response shape is declared where it is returned; a separate domain model or repository is unnecessary for this single infrastructure query.

## Related

- [Backend module index](../README.md)
