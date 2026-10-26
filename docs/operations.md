# Using the CRM

Sign in with your email and password. The CRM opens on **Customers**. Use the sidebar to switch between Customers, Sales orders, Accounts, and, for administrators, Team members.

## Customers

**Customers → New customer** opens the customer form. Enter a name and unique account code, then select **Create customer**. The new customer's detail page opens immediately.

The customer table supports search by name or code and paginated results. Select the customer name or **View customer** to open its record. **Edit customer** changes the name and code while preserving order and transaction history. Changes are version checked and recorded in activity history.

A customer record has four tabs:

- **Orders:** customer orders with links to their detail pages.
- **Payments & credits:** receipts, charges, credit notes, credit applications, and refunds.
- **Rewards:** available, locked, redeemed, and pending recovery points with posting history.
- **Activity:** chronological customer activity, including payments and order changes.

The cards above the tabs show outstanding charges, unapplied cash, open credits, and spendable points.

## Creating an order

From a customer record, select **New order**. You can also use **Sales orders → New order** and select the customer there.

1. Select a customer.
2. Choose a product in the first item row. Its catalog price is filled in automatically.
3. Enter quantity and agreed unit price. Use **Add item** for additional products; add each product only once.
4. Review the line amounts and order total, then select **Create order**.

The order opens as a draft. **Submit for approval** sends the active commercial revision for KAM review. KAM can **Approve order** or **Reject**, with a reason required for rejection. Admin can perform these actions directly.

The sales order table supports search by order number or customer, filtering by approval status, and filtering by fulfillment progress. Approval and fulfillment are shown separately: an approved order may still be loading, dispatched, partially delivered, or delivered. Select an order number or **View order** to open its detail page.

## Editing and cancellation

**Edit order** opens the line-item form for an undispatched order. Update products, quantities, and prices, enter a reason, and save. A commercial change creates another revision, invalidates earlier approval and pending loading documents, and requires approval again. The revision history retains earlier documents.

**Cancel items** opens a quantity form for unshipped units. Each line initially selects its entire eligible remainder; reduce the quantity or enter zero to leave some demand open. Enter a reason and confirm. Dispatched or delivered quantities cannot be canceled this way.

After dispatch, ordinary editing is unavailable. KAM or Admin uses **Shipments → Record shipment correction** for authorized extra goods. The form requires the actual physical dispatch, quantities, delivered quantities, price, supporting evidence, authorization reference, and reason. Original dispatch documents remain intact.

## Shipments, deliveries, and returns

Warehouse users can **Prepare shipment** after the current order revision is approved. Enter the quantities to load. The Shipments tab lists each physical batch with its own loaded, dispatched, delivered, and returned quantities.

- **Dispatch shipment** confirms that a loaded batch left the warehouse.
- **Confirm delivery** records the quantities actually delivered from a dispatched batch. Enter partial quantities when necessary; later confirmations can record the remainder.
- **Record a return** selects previously delivered, unreturned units and any explicit return deduction. A return keeps the original delivery history and does not reopen demand.

Further shipments can fulfill remaining unshipped demand. Only confirmed delivered quantities create charges.

## Customer accounts

The **Accounts** table lists customer balances and links to their account records. It shows outstanding charges, unapplied cash, open credit, and the net position. A positive net balance means the customer owes money; a negative balance is in the customer's favor.

Accounts users can select **Record payment** from a customer record. Enter the amount and bank reference. Payments belong to the customer, and eligible charges are settled in date order. Advances stay unapplied until eligible charges exist.

In **Payments & credits**:

- **Payments** lists customer receipts.
- **Charges** shows delivered goods, returns, deductions, and outstanding amounts by order.
- **Credit notes** shows issued, applied, refunded, and available credit. Use the row's **Apply** or **Refund** button for an open credit.
- **Applications & refunds** retains settlement entries. **Reverse** opens a partial or full reversal form. A refund reversal also requires a bank reference. Original entries are retained.

**Reserve credit** converts eligible unapplied cash into an explicit customer credit. **Allocate cash** reruns allocation to eligible outstanding charges. Neither creates another cash receipt. Expand **Balance checks** to review current quantities, funding, settlement, balance, and reward checks.

In **Rewards**, Sales or Accounts can redeem available points against an outstanding charge. Locked points cannot be spent. One point settles one paise. Credits and point settlements do not earn additional points.

## Permissions and saving

Buttons appear for the acting staff member's role. The API independently enforces permissions. Sales creates and revises orders; KAM approves revisions; Warehouse manages physical fulfillment; Accounts handles cash and credit. Sales, Accounts, and Admin can create and edit customer identity. All active roles can inspect the CRM tables and detail pages. See [permissions](business-terms.md#permissions) for the complete operation list.

Administrators can use **Working as** in the header to submit order and account activities as another active staff member. Both the acting staff member and signed-in administrator are recorded. Creating a customer and managing Team members use the signed-in user's permissions.

Forms show validation and business errors without closing. If another activity changed a record, reload its current version before resubmitting. Action forms offer **Reload current record**; order detail pages also have **Refresh**. Saving uses request keys so retrying an uncertain action response does not repeat its postings.

## Related

- [Documentation index](README.md)
- [API reference](api.md)
- [Business terms](business-terms.md)
- [Verification](verification.md)
- [Development setup](../CONTRIBUTING.md)
- [Architecture](architecture.md)
