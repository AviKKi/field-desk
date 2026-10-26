# Business reference

The CRM uses operating conventions version **2026-10-26.1**. The business guide is the source for the vocabulary and canonical behavior:

- [Business terms](candidate-walkthrough/business_terms.md): entities, states, roles, and actions.
- [Canonical business rules](candidate-walkthrough/canonical_business_rules.md): authority, transitions, quantities, finance, returns, corrections, rewards, and request integrity.

## Permissions

See [Roles and actions](candidate-walkthrough/business_terms.md#roles-and-actions). This includes the Admin override, acting staff selection, read access, and direct Warehouse return recording.

## Settlement corrections

See [Settlement reversal](candidate-walkthrough/canonical_business_rules.md#r9-settlement-reversal) and [Additional dispatched goods](candidate-walkthrough/canonical_business_rules.md#r5-additional-dispatched-goods) for the supported correction operations.

## Balance checks

See [Account position](candidate-walkthrough/canonical_business_rules.md#r11-account-position). Activity results preserve the terms version used for the request; an exact retry preserves the original outcome.

## Version history

| Version      | Effective date | Scope                                                                                     |
| ------------ | -------------- | ----------------------------------------------------------------------------------------- |
| 2026-10-26.1 | 2026-10-26     | Operating conventions for customer records, orders, fulfillment, settlement, and rewards. |

## Related

- [Documentation index](README.md)
- [Business guide](candidate-walkthrough/README.md)
- [Business terms](candidate-walkthrough/business_terms.md)
- [Canonical business rules](candidate-walkthrough/canonical_business_rules.md)
- [Operations desk](operations.md)
- [API reference](api.md)
- [Verification](verification.md)
