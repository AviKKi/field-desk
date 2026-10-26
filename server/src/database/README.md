# Database infrastructure

Owns the shared SQLite connection, Drizzle initialization, migration execution, and schema discovery for tooling.

## Implementation

- [database.service.ts](database.service.ts): Opens and closes SQLite, enables WAL and foreign keys, sets the busy timeout, and exposes the typed Drizzle connection.
- [database.module.ts](database.module.ts): Provides the shared connection to Nest providers.
- [schema.ts](schema.ts): The single schema entry point exporting tables from their owning model files.
- [query-order.ts](query-order.ts): SQLite insertion-order tie-breaking used by ordered repository reads.
- [migrate.ts](migrate.ts): Explicit CLI migration context and migration-directory resolution.

## Coordination

Domain repositories all use this connection. Synchronous repository calls therefore participate in the immediate transaction and nested savepoint opened by Actions, or in the read transaction opened by a query service. Table definitions stay in their owning modules; migration SQL and metadata stay under `server/drizzle`. Starting the API never applies migrations.

## Related

- [Backend module index](../README.md)
