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

| Command             | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`          | Build shared contracts, then watch all three packages                      |
| `pnpm dev:server`   | Build shared contracts and watch the API                                   |
| `pnpm dev:client`   | Run Vite; build shared first on a fresh checkout                           |
| `pnpm check`        | Lint, type-check, run API tests, and build                                 |
| `pnpm metrics`      | Write source counts and file hashes to `reports/source-metrics.json`       |
| `pnpm format:check` | Check formatting                                                           |
| `pnpm db:generate`  | Generate a migration after changing the Drizzle schema                     |
| `pnpm db:migrate`   | Apply committed migrations                                                 |
| `pnpm db:seed`      | Add a complete local dataset across order, fulfillment, and account states |
| `pnpm db:studio`    | Open Drizzle Studio                                                        |
| `pnpm admin:create` | Bootstrap an admin without public privilege escalation                     |

Keep migration SQL and its Drizzle metadata together in version control. Migrations are explicit; starting the API never changes the schema.

## Local dataset

`pnpm db:seed` requires an existing active admin and applied migrations. It creates ten customer accounts and 24 orders with ordinary business histories, plus the product catalog and four staff desks. It applies real order, warehouse, and account actions so approvals, physical quantities, charges, points, and audit records agree.

The dataset includes:

| Area                | Records to review                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Approval            | Draft, pending approval, approved, rejected, revised awaiting reapproval, and canceled orders                                            |
| Fulfillment         | Not started, loading, partly dispatched, dispatched, partly delivered, delivered, and canceled demand                                    |
| Shipments           | Multiple batches, a second batch loading during partial delivery, voided loading after a revision, and an authorized dispatch supplement |
| Accounts            | Unpaid, partly paid, fully paid, an unapplied advance, and customer receipts                                                             |
| Returns and credits | Paid returns with deductions, open credit, partial credit application, refund, and settlement reversals                                  |
| Rewards             | Locked, available, redeemed, and pending recovery points                                                                                 |

The Sales orders table has separate **Approval** and **Fulfillment** columns and filters. Customer account tabs show the receipts, credit notes, refunds, rewards, and activity behind each balance.

The seed is transactional and records completion only after all account checks pass. Running it again reports the existing dataset and preserves subsequent edits and transactions, including when another administrator runs the command. Seeding runs only through the CLI and refuses production use.

Staff desks have no published login passwords; use the existing admin's **Working as** selector or create staff accounts through Team members. The seed does not replace or promote existing user accounts.

## Verification

API tests use temporary SQLite files, real migrations, NestJS, and HTTP requests. They verify authentication, role boundaries, input validation, sessions, CSRF checks, rate limits, business workflows, settlement reversals, concurrency, idempotency, and upgrade safety. The customer workflow suite submits its own HTTP actions and verifies independently calculated outcomes across fourteen canonical cases and 200 deterministic mixed sequences. Its request limit is raised only inside that test application; authentication and permissions remain active, and the authentication suite tests normal rate limiting.

`pnpm test` writes the workflow outcomes, action latencies, and memory sample to `reports/customer-workflows.json`. `pnpm metrics` writes TypeScript source counts and file hashes. Generated reports are ignored by Git. See [verification](docs/verification.md) for coverage, measurement definitions, and limitations.

## Changes

Keep browser code out of `server` and server code out of `shared`. Shared contracts are consumed through package exports, never by importing another package’s source. Keep domain models, repositories, services, and controllers within their owning backend module. Put invariants and value calculations in models, database access in typed Drizzle repositories, and cross-domain coordination in services. Controllers stay focused on HTTP. Cross-domain reads can import the owning repository module; avoid circular service dependencies. Schema export barrels are for Drizzle tooling and compatibility. Submit the relevant check results with changes.

## Related

- [Project overview](README.md)
- [Documentation index](docs/README.md)
- [Architecture and deployment](docs/architecture.md)
- [API reference](docs/api.md)
- [Operations desk](docs/operations.md)
- [Verification](docs/verification.md)
