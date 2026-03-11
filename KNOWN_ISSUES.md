# Known Issues (Inventory Metadata/Image Resolution)

Last updated: 2026-03-10

The current GC/schema-based implementation still has unresolved display issues that need a follow-up pass:

1. Sticker previews are still missing for some weapons in the item details view (stickers applied on the weapon do not always show thumbnails).
2. Some weapons (notably items that appear with `SU` context) still resolve incorrect market hash names.
3. Main inventory should exclude storage-unit-contained items after authentication; any remaining visibility regressions should be treated as a bug.
4. Standalone charms still have inconsistent market hash and image resolution in some cases. Expected format is `Charm | <Charm Name>` (example: `Charm | Disco MAC`) with charm-specific art and pattern/template data.
5. Trade-locked containers still have inconsistent image resolution. Example behavior observed: some Falchion cases resolve correctly while other trade-locked cases do not.
6. Trade-locked items will not show in the steam web inventory so we cannot use that solution. The fallback image resolver is being overused as shown by the 429 errors in the console log below. Please review the cs2 game files, cs2 item schema, and online resources to determine how to gracefully resolve images for each item type and display them without overloading steam servers.
7. In the storage unit/container viewer,  most of the storage unit's items do not resolve images, rarities, etc. 
8. In the storage unit/container viewer,  item rows are not properly formatted as it requires the user to zoom to 20% view to see the inventory. 
Additional context:
- There are still broad gaps in image coverage across a subset of inventory items, especially when Steam description/icon fallbacks are not available or do not return exact matches.
