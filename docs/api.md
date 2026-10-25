# API reference

All routes use `/api`. Body-bearing writes accept JSON. Authentication uses the `crm_session` cookie. Browser writes need the configured Origin; command-line clients may omit Origin.

| Method | Route                 | Access            | Behavior                                                                    |
| ------ | --------------------- | ----------------- | --------------------------------------------------------------------------- |
| GET    | `/health`             | Public            | Database connectivity check                                                 |
| POST   | `/auth/register`      | Public, 5/min/IP  | `{ name, email, password }`; creates Sales user and signs in                |
| POST   | `/auth/login`         | Public, 10/min/IP | `{ email, password }`; signs in                                             |
| GET    | `/auth/me`            | Signed in         | `{ user }`                                                                  |
| POST   | `/auth/logout`        | Signed in         | Revokes current session, clears cookie, returns 204                         |
| GET    | `/users`              | Admin             | Paginated team list                                                         |
| POST   | `/users`              | Admin             | `{ name, email, password, role }`; creates user, without signing in as them |
| PATCH  | `/users/:id`          | Admin             | `{ role?, active? }`; revokes target’s sessions                             |
| GET    | `/workspace/sales`    | Sales, Admin      | Sales workspace metadata                                                    |
| GET    | `/workspace/accounts` | KAM, Admin        | Key account workspace metadata                                              |

Other routes use a default limit of 120 requests/minute/IP. Roles are exactly `SALES`, `KAM`, `ADMIN`. Admins may access both workspaces. Sales and KAM cannot access one another’s workspace or team management.

`GET /users` accepts `search` (up to 100 characters), `page` (default 1), and `pageSize` (default 20, maximum 100). Search is a literal case-insensitive name/email substring. Its response is `{ users, total, page, pageSize }`.

The public user shape is `{ id, name, email, role, active, createdAt }`. IDs are UUIDs and creation timestamps are ISO strings. Auth routes and user mutations return `{ user }`. JWTs and password hashes are never response fields.

Validation errors return 400 with a message and field issues. Missing/invalid sessions return 401, role failures return 403, missing users return 404, duplicate emails return 409, unsupported body content types return 415, and rate limits return 429. A self-directed role/status update returns 400. Accounts are deactivated rather than deleted.

## Related

- [Documentation index](README.md)
- [Architecture](architecture.md)
- [Development workflow](../CONTRIBUTING.md)
