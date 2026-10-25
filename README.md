# FieldDesk CRM

A pnpm workspace with React, shadcn/ui, Zustand, NestJS, Drizzle, SQLite, and email/password JWT authentication.

| Package  | Responsibility                                                                    |
| -------- | --------------------------------------------------------------------------------- |
| `client` | React + Vite application, shadcn/ui components, in-memory Zustand auth state      |
| `server` | NestJS API, authentication, role enforcement, user management, SQLite persistence |
| `shared` | Zod request schemas, public API types, role definitions                           |

Sales, Key Account Manager (KAM), and Admin roles have dedicated access. Admins can create team members, assign roles, and activate or deactivate accounts. New registrations receive Sales access.


Start with [local development](CONTRIBUTING.md), then see the [documentation index](docs/README.md) for architecture and API details.

## Related

- [Development setup](CONTRIBUTING.md)
- [Documentation](docs/README.md)
