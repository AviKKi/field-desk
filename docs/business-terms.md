# Business terms

Version **2026-10-26.1**, effective 26 October 2026. These are the local application's operating conventions. They resolve unspecified behavior for this version; they are not a record of external business approval. Activity results preserve the version used when each request was processed. A retry returns its original recorded result.

| ID   | Topic                                   | Behavior in this version                                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-01 | Charge recognition                      | Confirmed delivered quantities create charges at the agreed shipment-line price. Loading and dispatch alone do not create receivables. Each incremental confirmation has its own charge.                                                                                                                                                                                       |
| P-02 | Initial points                          | Approval creates locked entitlement for the exact commercial revision, after cancellations. Draft and pending revisions have no spendable entitlement.                                                                                                                                                                                                                         |
| P-03 | Receipt allocation                      | Capture cash against a customer. Automatically allocate to positive outstanding charges by creation time, then insertion order. Advances wait for charges and are allocated when delivery is recorded. Accounts can rerun allocation; manual allocation overrides are unavailable.                                                                                             |
| P-04 | Point calculation                       | Each SKU has a fixed points-per-unit rate copied into commercial and shipment documents. For each charge, earned points are `floor(qualifying cash paise × points per unit / unit price paise)`, capped by retained approved entitlement. Round down separately for each charge; sum afterward. Fees earn no points.                                                           |
| P-05 | Unlocking                               | Qualifying allocated cash unlocks proportionally; unpaid entitlement stays locked. Approval, dispatch, delivery, open credit, and unapplied advances alone do not unlock points.                                                                                                                                                                                               |
| P-06 | Redemption                              | Sales, Accounts, or Admin can redeem available points against a customer charge. One point settles one paise. Redemption and credit application do not count as qualifying cash and earn no new points.                                                                                                                                                                        |
| P-07 | Spent returns                           | Reverse entitlement attributable to returned goods. If already spent, record clawback pending, keep available points nonnegative, and prevent further redemption while debt remains. Later accrual offsets debt before becoming available.                                                                                                                                     |
| P-08 | Return deductions                       | Warehouse or Admin records a nonnegative explicit fee with the physical return and a reason. The fee may not exceed gross returned value. No automatic fee schedule or write-off is authorized.                                                                                                                                                                                |
| P-09 | Customer credit                         | Returns reserve released cash as a receipt-backed credit after fees. Accounts or Admin can explicitly reserve existing unapplied cash, apply an open credit, or record a refund. No automatic credit application or unfunded adjustment grant occurs. Partial applications and refunds are allowed.                                                                            |
| P-10 | Loading-stage edits                     | Sales or Admin may revise before any dispatch. Create a new immutable revision, void pending loading documents, compensate old locked points, and require current KAM approval. A cancellation also voids pending loading documents; remaining demand can be loaded again.                                                                                                     |
| P-11 | Exceptional authorization               | KAM or Admin records a post-dispatch correction with a reason, evidence, and authorization reference. The acting staff member is the authorizer. Ordinary edits remain blocked after dispatch. Admin may approve and correct directly; every action records both acting staff member and signed-in requester. There is no multi-party approval or prior-period override.       |
| P-12 | Extra shipped goods                     | Require an explicit existing dispatch or separate dispatch with an actual past timestamp. Missing facts produce a question without business mutations. Append a supplement, a new commercial revision, and its authorization; preserve original dispatch documents. Only confirmed delivered extra units create charges. Additional units of an existing SKU retain its price. |
| P-13 | Returned demand                         | Returns do not reopen demand. Cancellations affect only unshipped quantities, either all remaining demand or the explicitly selected line quantities. Replacement demand requires another order.                                                                                                                                                                               |
| P-14 | Partial payments and advances on return | Reduce the original charge. Release excess cash allocation first, then credit settlement, then point settlement. Released cash pays the return fee first; remaining released cash becomes funded credit. Unpaid goods reduce outstanding obligations without inventing credit cash. Previously unapplied cash may settle eligible fees or other charges under FIFO.            |
| P-15 | Amount conventions                      | INR integer paise; positive integer item quantities; positive integer points for redemption. No taxes, discounts, other currencies, or real bank movement. Positive net account position means the customer owes money; negative means value is owed to the customer.                                                                                                          |

## Settlement corrections

Accounts or Admin may reverse part or all of a credit application using its original entry ID, an amount, and a reason. Append a negative application referencing that entry. The amount must fit both the original entry's unreversed amount and the credit still applied to the same charge. Returns may already have released some of that settlement. Reversal restores open credit and outstanding charge without capturing cash or awarding points. It does not automatically allocate newly available settlement capacity.

A recorded refund can be reversed only to record money returned or a corrected bank transfer. Supply the original refund entry ID, amount, reason, and bank reference. Append a negative refund referencing the original and restoring open credit. Each original refund entry may be reversed only up to its recorded amount. A refund split across receipts has separate entries; reverse the affected entries individually. This is bookkeeping, with no transfer initiated by the application.

Neither operation edits the original entry or deletes its audit history. Use a fresh request key and the current customer version for each correction.

## Permissions

Warehouse and Admin submit physical returns. Sales and Admin cancel eligible quantities. KAM and Admin approve or reject exact revisions. Accounts and Admin receive money, reserve and settle credits, record refunds, and reverse settlements. Sales and Accounts may redeem customer points; Admin may do so directly. Other authenticated roles can inspect customer records but cannot grant themselves action permissions.

## Balance checks

The account position is:

```text
net = retained delivered goods + return fees − receipts + net refunds − net point settlements
net = outstanding charges − unapplied cash − open credits
```

Credit application moves value between open credit and an outstanding charge; it does not change the net position. Refund reversal reduces net refunds and restores the customer's credit. Cash reserved for a credit remains reserved even after application or refund, preventing receipt reuse.

Account checks also compare quantities, revision approvals, delivery charges, credit funding, and reward conservation. A new action that leaves these checks failing is rolled back; its rejected request result remains available for an exact retry. Earlier posting history remains intact.

## Version history

| Version      | Date       | Changes                                                                                                             |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-10-26.1 | 2026-10-26 | Record allocation, recognition, return, authorization, rounding, settlement correction, and permission conventions. |

## Related

- [Documentation index](README.md)
- [Operations desk](operations.md)
- [API reference](api.md)
- [Verification](verification.md)
