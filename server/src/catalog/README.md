# Catalog

Owns product reference records: SKU identity, catalog price, and points per unit.

## Implementation

- [catalog.model.ts](catalog.model.ts): The `skus` table, storage constraints, and inferred product type.
- [catalog.repository.ts](catalog.repository.ts): Typed SKU lookup and ordered catalog reads.
- [catalog.controller.ts](catalog.controller.ts): The authenticated product catalog endpoint.
- [catalog.module.ts](catalog.module.ts): Connects the read controller to the catalog repository provider.

## Coordination

Orders and Fulfillment read product definitions when creating commercial and shipment documents. Those documents retain their own agreed price and points rate. CLI seeding initializes the local catalog. There is no product-editing endpoint or forwarding service; the controller delegates the read directly to the repository.

## Related

- [Backend module index](../README.md)
