# Societyer Inventory Shape

Created: 2026-06-02

## Reference System

Societyer should borrow the shape of a real inventory system without embedding a full warehouse or ERP application. The first reference target should be OpenBoxes.

OpenBoxes is a useful reference because it is open source, inventory-specific, and built around stock movement history rather than only current asset rows. Its public documentation describes the inventory concepts Societyer needs to remain compatible with a fuller inventory system later: products/items, facilities, bin locations, lot and serial tracking, expiration dates, stock adjustments, stock movement history, demand/consumption tracking, and source-document traceability.

References:

- OpenBoxes site: https://openboxes.com/
- OpenBoxes features: https://openboxes.com/features/
- OpenBoxes documentation: https://docs.openboxes.com/en/latest/
- OpenBoxes API stock movements: https://openboxes.cloud/docs/api/stock-movements
- OpenBoxes GitHub repository: https://github.com/openboxes/openboxes

Odoo and ERPNext are strong ERP references, but they are broader than Societyer needs for the first internal shape. OpenBoxes is a better first inventory reference because its stock card and movement model maps cleanly to Societyer's current assets, consumables, QR labels, verification runs, grant restrictions, receipt evidence, and custody workflows.

## Design Goal

The user-facing product remains a simplified first-party Societyer inventory and asset module:

- Asset register
- Consumable stock counts
- QR/barcode labels
- Custody and checkout
- Locations and bins
- Physical inventory verification
- Maintenance, warranty, and disposal evidence
- Grant-funded equipment and supply restrictions
- Receipt and purchase evidence
- Board/audit-ready inventory reports

Underneath that UI, Societyer should maintain inventory-compatible records so it can later sync with OpenBoxes, Odoo, ERPNext, Snipe-IT, or another inventory provider.

## Data Flow

```text
External inventory app / CSV / receipt / purchase / manual count
        |
        v
inventoryCandidates
        |
        v
review, match, classify, approve
        |
        v
inventoryItems + inventoryLots + stockMovements
        |
        v
inventoryBalances
        |
        v
Societyer asset, custody, grant, verification, and audit views
        |
        v
optional provider sync / write-back
```

`inventoryCandidates` are source rows. They can be incomplete, duplicated, messy, or unreviewed.

`stockMovements` are the durable inventory ledger. Current on-hand counts should be derived from posted movements or stored as a maintained balance table that is traceable back to movement rows.

## Internal Model

### `inventoryConnections`

Represents an external inventory or import source.

Examples:

- `openboxes`
- `odoo`
- `erpnext`
- `snipeit`
- `csv`
- `receipt`
- `manual`
- `demo`

### `inventoryItems`

Represents the catalog item or asset type.

Important fields:

- `sku`
- `name`
- `description`
- `category`
- `itemType`: `asset | consumable | supply | software | service | other`
- `unitOfMeasure`
- `defaultCostCents`
- `currency`
- `trackSerial`
- `trackLot`
- `trackExpiry`
- `reorderPoint`
- `externalId`
- `sourceSystem`

OpenBoxes mapping:

- product id -> `externalId`
- product code/SKU -> `sku`
- product name -> `name`
- product category -> `category`
- unit of measure -> `unitOfMeasure`
- lot/serial/expiry flags -> tracking fields

### `inventoryLocations`

Represents facilities, rooms, shelves, bins, off-site storage, member custody locations, and disposal locations.

Important fields:

- `name`
- `locationType`: `facility | room | shelf | bin | custody | in_transit | vendor | disposed | virtual`
- `parentLocationId`
- `address`
- `active`
- `externalId`
- `sourceSystem`

OpenBoxes mapping:

- facility/depot/location id -> `externalId`
- location name -> `name`
- location hierarchy -> `parentLocationId`
- depot/bin/ward/pharmacy/other role -> `locationType`

### `inventoryLots`

Represents a batch, lot, serial number, or uniquely tracked physical unit.

Important fields:

- `inventoryItemId`
- `lotNumber`
- `serialNumber`
- `expiresAt`
- `manufacturer`
- `manufacturedAt`
- `condition`
- `status`
- `assetId`
- `externalId`
- `sourceSystem`

For durable equipment, this can link to the existing `assets` table. For consumables, it can represent a lot or batch. For simple supplies, it may be omitted.

### `stockMovements`

Represents the inventory event ledger.

Important fields:

- `movementDate`
- `movementType`: `receive | issue | transfer | adjustment | count | consume | return | dispose | reserve | unreserve`
- `status`: `draft | posted | void | needs_review`
- `inventoryItemId`
- `inventoryLotId`
- `fromLocationId`
- `toLocationId`
- `quantity`
- `unitOfMeasure`
- `unitCostCents`
- `totalCostCents`
- `reason`
- `reference`
- `sourceExternalId`
- `sourceSystem`
- `assetEventId`
- `purchaseTransactionId`
- `receiptDocumentId`
- `grantId`
- `fundRestrictionId`
- `documentIds`

### `assetReceiptLinks`

Represents a reviewed link between one receipt/invoice line and an asset or inventory item.

Important fields:

- `assetId`
- `inventoryItemId`
- `receiptDocumentId`
- `financialTransactionId`
- `receiptLineLabel`
- `receiptLineIndex`
- `quantity`
- `unitOfMeasure`
- `unitCostCents`
- `totalCostCents`
- `sourceText`

This lets Societyer answer: "Which receipt line bought this asset or stock item?" without forcing the whole receipt into the asset row. It also allows a receipt with multiple purchased items to link each line to different assets or inventory items.
- `rawJson`

OpenBoxes mapping:

- stock movement id -> `sourceExternalId`
- line item/product -> `inventoryItemId`
- origin/destination -> `fromLocationId` and `toLocationId`
- quantity picked/shipped/received/adjusted -> `quantity`
- lot/serial/expiry data -> `inventoryLotId`
- movement state -> `status`

### `inventoryBalances`

Represents current quantity by item, lot, and location.

Important fields:

- `inventoryItemId`
- `inventoryLotId`
- `locationId`
- `quantityOnHand`
- `quantityReserved`
- `quantityAvailable`
- `lastMovementId`
- `lastCountedAtISO`

This table is optional but useful for fast UI. It must be maintained from posted stock movements, not treated as the source of truth.

### `inventoryCounts`

Represents a physical count or verification run.

Important fields:

- `title`
- `startedAtISO`
- `completedAtISO`
- `status`
- `reviewerName`
- `locationId`
- `scope`
- `sourceDocumentIds`
- `notes`

This maps to the current `assetVerificationRuns` concept, but should eventually support consumables and supplies in addition to durable assets.

### `inventoryCountLines`

Represents each counted item during a physical inventory run.

Important fields:

- `inventoryCountId`
- `inventoryItemId`
- `inventoryLotId`
- `locationId`
- `expectedQuantity`
- `countedQuantity`
- `varianceQuantity`
- `condition`
- `status`
- `notes`
- `adjustmentMovementId`

### `inventoryCandidates`

Represents imported or extracted rows before posting.

Examples:

- OpenBoxes stock movement rows
- CSV inventory rows
- receipt-extracted purchase items
- manual physical-count rows
- existing `assets` imports

Candidates should not be treated as the inventory ledger.

## Relationship To Existing Tables

The current Societyer tables already cover useful first-party workflows:

- `assets`
- `assetEvents`
- `assetMaintenance`
- `assetVerificationRuns`
- `assetVerificationItems`

Those tables are good for durable assets, custody, maintenance, QR labels, and board/audit evidence.

What is missing is the main inventory abstraction: item/location/lot movement history. Today, `assets.quantityOnHand` and `assetEvents` can describe consumable intake, but they do not yet provide a provider-neutral stock ledger for transfers, consumption, adjustments, counts, and lot/expiry tracking.

## Migration Approach

Do not remove `assets` or `assetEvents`.

Use this sequence:

1. Keep `assets` as the first-party durable asset register.
2. Add `inventoryItems`, `inventoryLocations`, `inventoryLots`, `stockMovements`, `inventoryBalances`, `inventoryCounts`, `inventoryCountLines`, and `inventoryCandidates`.
3. Link existing durable assets to `inventoryItems` and, where needed, `inventoryLots`.
4. Mirror existing intake, checkout, transfer, disposal, and verification activity into posted `stockMovements`.
5. Update consumable stock and inventory reports to read from `inventoryBalances`.
6. Keep current asset views intact while gradually adding inventory-ledger-backed views.
7. Add an OpenBoxes sync adapter once the internal movement model is exercised locally.

## Provider Strategy

OpenBoxes is the first shape reference, not necessarily the first production connector.

Initial provider roles:

- OpenBoxes: reference model and future inventory sync target.
- CSV/manual/receipt imports: first transaction intake for real organizations.
- Existing Societyer assets: first-party register and evidence layer.
- Odoo/ERPNext: later adapters if a society already runs a broader ERP.
- Snipe-IT: later adapter for IT asset-specific environments, not the first stock-ledger reference.

The provider adapter should map external product, location, lot, movement, and source identifiers onto Societyer tables without forcing the UI to become provider-specific.
