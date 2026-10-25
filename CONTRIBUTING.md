# Development

Use Node.js 22.14+ or 24 and pnpm 10.18.3.

```sh
pnpm install
pnpm env:setup
pnpm db:migrate
pnpm admin:create
pnpm db:seed
pnpm dev
```

`env:setup` creates `server/.env` with a random JWT secret and preserves an existing file. `admin:create` prompts for the name, email, and password, with password input hidden. It refuses to promote or overwrite an existing account. There are no default credentials.

Open <http://localhost:5173>. The API runs at <http://localhost:3000/api>; Vite proxies `/api` to the backend. Keep `CLIENT_ORIGIN` consistent with the URL you use in your browser. The default is `http://localhost:5173`.

For unattended admin creation, supply `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` through your environment. Avoid putting passwords in shell history. These variables are only read by the admin command.

## Commands

| Command             | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`          | Build shared contracts, then watch all three packages                     |
| `pnpm dev:server`   | Build shared contracts and watch the API                                  |
| `pnpm dev:client`   | Run Vite; build shared first on a fresh checkout                          |
| `pnpm check`        | Lint, type-check, run API tests, and build                                |
| `pnpm format:check` | Check formatting                                                          |
| `pnpm db:generate`  | Generate a migration after changing the Drizzle schema                    |
| `pnpm db:migrate`   | Apply committed migrations                                                |
| `pnpm db:seed`      | Add the local catalog, customers, and staff desks after creating an admin |
| `pnpm db:studio`    | Open Drizzle Studio                                                       |
| `pnpm admin:create` | Bootstrap an admin without public privilege escalation                    |

Keep migration SQL and its Drizzle metadata together in version control. Migrations are explicit; starting the API never changes the schema.

## Verification

API tests use a temporary SQLite file, real migrations, NestJS, and HTTP requests. They verify role boundaries, input validation, session revocation, CSRF origin checks, and credential rate limits.

## Changes

Keep browser code out of `server` and server code out of `shared`. Shared contracts are consumed through package exports, never by importing another package’s source. Place business logic in providers and keep controllers focused on HTTP. Submit the relevant check results with changes.

## Related

- [Project overview](README.md)
- [Documentation index](docs/README.md)
- [Architecture and deployment](docs/architecture.md)
- [API reference](docs/api.md)
- [Operations desk](docs/operations.md)
