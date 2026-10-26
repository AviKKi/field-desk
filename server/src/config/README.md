# Configuration

Owns runtime environment validation and the typed configuration contract.

## Implementation

- [environment.ts](environment.ts): Zod parsing, defaults, port and session limits, secret validation, and production origin requirements.

## Coordination

`AppModule` and the migration context use `validateEnvironment` during startup. Consumers retrieve validated settings through Nest `ConfigService`. The root `env:setup` script creates a local environment file; this directory validates settings rather than generating credentials. See the backend index for configuration and deployment documentation.

## Related

- [Backend module index](../README.md)
