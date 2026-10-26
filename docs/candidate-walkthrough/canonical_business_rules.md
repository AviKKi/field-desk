# Canonical business rules

Version **2026-10-26.1**. Apply these rules together. `require` rejects an operation when its predicate is false. Signed totals include compensating entries. Permissions and entity meanings are defined in [Business terms](business_terms.md). Payload fields and limits are defined in the [API contract](../../shared/src/crm.ts).

## R1. Valid authority and evidence

Require an active authenticated requester and an active actor. A new command requires the action's permitted role. Only Admin can select another actor. Require existing references within the selected customer/order/shipment and distinct submitted item identities. Require valid payloads, positive quantities/amounts, and safe integer calculations; explicitly permitted zero values are return fees and corrected delivered quantities. Customer codes and staff emails are unique.

Preserve commercial revisions, dispatched facts, receipts, and financial/reward postings. Record adjustments as linked additions. Each applied CRM command has one activity with its actor, requester, and source references.

## R2. Atomic requests

An operation must preserve all applicable rules before commit. Rejection or an unresolved decision commits no business changes. Request outcomes remain available for retries.

A key belongs to its requester. An exact retry returns the saved result. Reuse with changed command, actor, or expected version conflicts. Every command except `PUNCH_ORDER` requires a matching expected version: order version for `orderId`, customer version for `customerId`. If supplied for `PUNCH_ORDER`, check the customer version. An applied command increments the customer version and every order version on that customer. A changed or resolved request uses a new key.

## R3. Commercial authority

Create an order at revision 1 in `DRAFT`. Store each line's agreed price and the SKU's current reward rate. Customer creation starts at version zero; identity updates preserve history and unique codes.

| Operation      | Required condition                                                              | Result                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit           | No dispatch, no cancellation entry, and status is not `CANCELLED`.              | Append a revision. Use `REAPPROVAL_REQUIRED` if previously approved/awaiting reapproval; otherwise use `DRAFT`. Void loading documents and compensate old locked entitlement. Retain line keys for retained SKUs. |
| Submit         | `DRAFT`, `REJECTED`, or `REAPPROVAL_REQUIRED`.                                  | Use `PENDING`, retaining `REAPPROVAL_REQUIRED` when already set.                                                                                                                                                  |
| Approve/reject | `PENDING` or `REAPPROVAL_REQUIRED`; requested revision equals current revision. | Record the decision and set `APPROVED`/`REJECTED`. Approval establishes locked entitlement for uncanceled units.                                                                                                  |

Loading and dispatch require `APPROVED` and approval evidence for the current revision. A loading document must also name that revision when dispatched.

## R4. Quantity bounds

For each current commercial line, let `Q` be ordered units, `C` canceled units, `S` dispatched units, `D` delivered units, `R` returned units, and `L` units in nonvoided loading batches:

```text
open = Q - C - S
0 <= R <= D <= S
0 <= L <= open
C >= 0; open >= 0
```

Apply delivery/return bounds separately to each physical shipment line. Loading reserves open demand. Dispatch only a `LOADING` batch; move its whole loaded quantity to dispatched units. Confirm delivery only for a `DISPATCHED` batch. Add only previously unconfirmed dispatched units; set `DELIVERED` when every dispatched unit is confirmed. A partial confirmation leaves it `DISPATCHED`.

Cancellation removes selected open quantities, or all open quantities when items are omitted. Require a nonempty effective cancellation. Void pending loading batches. Set commercial status `CANCELLED` only when all ordered units are canceled and none were dispatched. Returns do not reopen demand or erase gross delivery quantities.

Order fulfillment uses the first matching condition below, summing current-line quantities:

```text
Q-C == 0       -> CANCELLED
D >= Q-C       -> DELIVERED
D > 0          -> PARTIALLY_DELIVERED
S >= Q-C       -> DISPATCHED
S > 0          -> PARTIALLY_DISPATCHED
L > 0          -> LOADING
otherwise      -> UNFULFILLED
```

## R5. Additional dispatched goods

Require an existing dispatch, a reason, evidence, and an authorization reference. Ask for the shipment location if absent. For an existing-shipment location, also ask if its identifier is absent. A supplied existing dispatch must belong to this order; a separate dispatch requires its actual timestamp, not in the future. For each added item, require `0 <= delivered <= added`.

Retain the price of an existing SKU line. Add new SKU lines at the supplied price. Preserve existing line rates; supplemental shipment lines use the SKU's current rate. Append a commercial revision, its authorization/approval, and a physical supplement. Keep original dispatch evidence. Void pending loading batches. Charge only confirmed additional deliveries. This action does not decrease or overwrite historical quantities.

## R6. Charge and cash conservation

Each delivery confirmation creates exactly one goods charge: `confirmed units * shipment-line price`. Loading/dispatch alone creates none. A return reduces its original goods charges by `returned units * shipment-line price`. Return deductions create separate fee charges.

For each charge and receipt:

```text
due = original charge + signed adjustments - cash applied - credit applied - points applied
free cash = receipt amount - net cash allocations - credit funding reserved
require due >= 0 and free cash >= 0
```

Receipts belong to customers. Allocate free cash across positive outstanding charges by creation time, then insertion order; visit receipts in the same ordering. Allocate at receipt capture, delivery/correction, return completion, or explicit allocation. Advances remain free until charges exist. Cancellation/rejection does not automatically reserve an advance as credit.

## R7. Return settlement

Record physical returns directly. Require a reason and an explicit fee `f`, with `0 <= f <= gross returned value`. Reduce source goods charges in insertion order. For any settlement exceeding a reduced charge, release cash first, then credit, then redeemed points. Within cash or credit, release source groups in reverse order of their first allocation/application. Restore each released settlement to its original receipt, credit note, or point balance.

Pay the fee first from released cash. Reserve remaining released cash as a receipt-backed credit. Run normal cash allocation afterward. Credit/point releases are not new receipts. An unpaid return reduces the obligation without inventing credit funding. Refresh reward entitlement after these adjustments.

## R8. Funded credit

For each credit note:

```text
issued = sum(receipt funding)
open credit = issued - net applications - net refunds
require open credit >= 0
```

Explicit issue reserves only free customer cash, using receipt insertion order. Applying credit requires `0 < amount <= min(open credit, selected charge due)`. A recorded refund requires `0 < amount <= open credit`, a bank reference, and receipt backing; split it in funding-entry insertion order, within each receipt's remaining funded refund capacity. Funding stays reserved after application/refund. Credit application is explicit and creates neither cash nor rewards.

## R9. Settlement reversal

Require a positive original settlement entry, a positive reversal amount, and a reason; append a linked negative entry. Application reversal is bounded by both that entry's unreversed amount and net credit still applied between its note and charge. Refund reversal is bounded by the entry's unreversed amount and requires a bank reference. Reverse split refunds per original entry. Restore open credit; application reversal also restores charge due. Do not run cash allocation automatically for either reversal.

## R10. Reward entitlement and settlement

For each current commercial line `l`, let `p_l` be its price, `r_l` its reward rate, and `cash_j` the net cash attributed to each positive goods charge for that line:

```text
entitlement_l = (status == APPROVED) ? max(0, Q_l-C_l-R_l) * r_l : 0
earned_l = min(entitlement_l, sum_j floor(cash_j * r_l / p_l))
locked = sum_l(entitlement_l - earned_l)
available = max(0, sum_l earned_l - net points redeemed)
clawback pending = max(0, net points redeemed - sum_l earned_l)
```

Round per charge before summing. Adjust ledger buckets to these values when qualifying facts change. Fees, unapplied advances, credit, and point settlements do not earn points. Later earnings offset pending clawback before becoming available.

Redemption requires zero pending clawback and `0 < points <= min(available, selected charge due)`. One point settles one paise. Reversing a point settlement reduces net redeemed points; changing entitlement preserves earlier redemption evidence.

## R11. Account position

All charges, allocations, funding, applications, refunds, and redemptions must stay within their source quantities/amounts and the same customer. Their signed totals must satisfy:

```text
net = delivered goods value - returned goods value + return fees
      - receipts + net refunds - net points redeemed
    = total charge due - total free cash - total open credit
```

A positive net means the customer owes money. A negative net means value is owed to the customer. No operation may create cash or physical facts merely to balance the account.

## Related

- [Walkthrough](README.md)
- [Business terms](business_terms.md)
- [Business reference](../business-terms.md)
- [Verification](../verification.md)
- [API reference](../api.md)
