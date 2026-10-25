# FieldDesk CRM

A local CRM for sales, warehouse operations, customer accounts, and finance, built with React, shadcn/ui, Zustand, NestJS, Drizzle, and SQLite in a pnpm workspace.

| Area           | Features                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| Orders         | Commercial revisions, submission, approval, rejection, and cancellation               |
| Fulfillment    | Loading, multiple shipments, partial deliveries, returns, and shipment corrections    |
| Accounts       | Customer receipts, cash allocation, credits, applications, and recorded refunds       |
| Rewards        | Locked and available points, redemption history, and pending recoveries               |
| Activity       | Staff attribution, document history, posting details, retries, and sample workflows   |
| Administration | Email/password sign-in, user management, and Sales/KAM/Warehouse/Accounts/Admin roles |

Use the operations desk to record individual activities or load a sample workflow and advance it one step at a time. Account summaries and document histories update from the API after each action.

See [development setup](CONTRIBUTING.md) to run locally and the [documentation index](docs/README.md) for operating and API references.

## Related

- [Development setup](CONTRIBUTING.md)
- [Documentation](docs/README.md)
