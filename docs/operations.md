# Operations desk

Sign in with an account created by your administrator. The operations desk opens after sign-in; team management is available to administrators through the sidebar.

## Getting started

An administrator can use **Load sample data** to add the catalog, customer accounts, and staff desks. Existing transactions are retained. The sample staff desks have no published login credentials; administrators can select a staff member to record an activity on their behalf. The activity records both that staff member and the signed-in administrator.

Choose a customer, an order when applicable, and an operation. Enter the details and select **Record activity**. Operations available in the form depend on the selected staff member. The server checks authorization independently.

- Sales creates and revises commercial orders, submits them, and cancels unshipped quantities.
- KAM reviews specific revisions and records commercial decisions and authorized shipment corrections.
- Warehouse records loading, dispatch, delivery, and returned quantities.
- Accounts records customer receipts, handles credits and refunds, and manages account settlements.
- Admin manages staff and may perform operations directly or on behalf of a selected active staff member.

## Reviewing documents

The customer selector shows the account being worked on. The order selector limits the order detail to that customer. The cards show the account position, outstanding charges, unapplied cash, open credit, and points buckets.

The order table keeps ordered, shipped, delivered, returned, canceled, and open quantities separate. Shipment cards show each physical batch and any recorded supplement. The history tab preserves commercial revisions and the order's activity timeline.

Account activity includes charges and adjustments, receipts, allocations, credit notes and applications, recorded refunds, reward postings, redemptions, returns, and shipment corrections. Expand an entry for its identifiers and source references.

An activity result shows whether it was applied, rejected, needs more information, or encountered a concurrent change. Expand **Recorded changes** to inspect the database records affected. **Retry request** resends the original request key; it does not create a fresh activity. **Export activity** downloads the current result and any loaded sample workflow report as JSON.

For returns, credit applications, and point redemptions, **Send competing requests** submits the same activity twice with separate request keys and the same record version. The two outcomes can be inspected separately.

## Sample workflows

Administrators can select a workflow and choose **Start workflow**, then **Next step** to inspect each activity. **Run workflow** completes the remaining activities, or starts a fresh customer case when there is no active workflow. Selecting an item in **Workflow activity** opens its result and posting changes.

Some workflows include an expected rejection or request for missing physical details. These results appear in the same activity list as successful operations. For an ordinary correction submitted through the form, choose the actual dispatch from the returned options, review the retained inputs, and submit again.

**Reset data** explicitly deletes CRM transactions and sample workflow history and reloads the sample customers. It requires confirmation, retains staff accounts, and is available only to local administrators. Sample loading and workflow execution are also disabled in production.

## Amounts

Forms accept INR amounts with at most two decimal places. The API stores monetary amounts as integer paise and uses integer quantities and points. One redeemed point offsets one paise. A positive net account balance means the customer owes money; a negative balance means the position is in the customer's favor. A credit application and a cash refund are separate recorded activities.

## Related

- [Documentation index](README.md)
- [API reference](api.md)
- [Development setup](../CONTRIBUTING.md)
