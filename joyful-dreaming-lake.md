# CS2 Armory Shop Feature — Implementation Plan

## Context

Add the ability to view CS2 Armory shop collections/items, see star (credit) balance, and purchase (redeem) armory items. The current `globaloffensive` package lacks armory methods, so we swap its import to `node-cs2` (100% API-compatible drop-in replacement with armory support). Existing inventory/casket logic stays untouched — only the `require()` line changes.

Data should come from official sources: GC shared objects for balance/state, `items_game.txt` from SteamDatabase for item metadata/collections.

---

## Step 1: Swap `globaloffensive` import to `node-cs2`

Import-only change — zero logic modifications to existing code.

| File | Change |
|------|--------|
| `package.json` | Add `"node-cs2"` dependency (keep `globaloffensive` as unused dep for now) |
| `src/steam/SteamClient.js:2` | `require('globaloffensive')` → `require('node-cs2')` |
| `src/steam/casket.js:1` | `require('globaloffensive')` → `require('node-cs2')` |

Run `npm install` after.

---

## Step 2: Capture Armory State from GC

**File: `src/steam/SteamClient.js`**

Add to constructor:
```js
this.armory = {
  personalStore: null,   // { generation_time, redeemable_balance, items[] }
  xpShop: null,          // { current_xp, current_level, prematch, postmatch }
  volatileOffers: [],    // [{ defidx, faux_itemid[], generation_time[] }]
};
```

Add event listeners in `_setupEventHandlers()`:
- `csgo.on('xpShopNotification', data => this.armory.xpShop = data)` — emitted by node-cs2 with `{ current_xp, current_level, prematch: CSOAccountXpShop, postmatch: CSOAccountXpShop }`
- Hook into node-cs2's SO cache system (inspect `csgo._handlers` or internal SO processing after install) to capture `CSOAccountItemPersonalStore` and `CSOVolatileItemOffer` shared objects when they arrive on GC connect

Reset `this.armory` in `logout()`.

---

## Step 3: Parse `items_game.txt` for Item Metadata

**New file: `src/data/itemData.js`**

- Fetches `items_game.txt` from `https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game.txt`
- **VDF parser**: Minimal recursive parser for Valve KeyValues format (`"key" "value"` / `"key" { ... }`)
- **Extracts**: item definitions (`Map<def_index, {name, image_inventory, prefab, rarity}>`), item sets/collections, loot lists, and armory-relevant categories
- **Caching**: In-memory, fetched once per server lifetime, re-fetchable on demand
- **Image strategy**: Use `image_inventory` paths from items_game.txt; construct full URLs via Steam CDN patterns. Update CSP in `src/server.js` if new image domains needed.

---

## Step 4: Armory Backend Module

**New file: `src/steam/armory.js`**

| Function | Description |
|----------|-------------|
| `getArmoryState(steamClient)` | Returns `{ balance, xp, level, personalStore, volatileOffers }` from `steamClient.armory` |
| `redeemItem(steamClient, { generationTime, redeemableBalance, items })` | Calls `csgo.redeemFreeReward(...)`, awaits `itemCustomizationNotification` type 9219 |
| `redeemMissionReward(steamClient, { campaignId, redeemId, redeemableBalance, expectedCost })` | Calls `csgo.redeemMissionReward(...)`, awaits notification type 9209 |
| `getCollections()` | Returns parsed collection data from `itemData.js` |

Reuses the `OperationQueue` pattern and `waitForNotification` helper from `src/steam/casket.js`.

---

## Step 5: API Routes

**New file: `src/routes/armory.js`**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/armory/state` | Armory balance, XP info, store items, volatile offers |
| `GET` | `/api/armory/collections` | Parsed item collections/definitions from items_game.txt |
| `POST` | `/api/armory/redeem` | Redeem an item. Body: `{ generationTime, redeemableBalance, items }` |

All routes use `requireAuth` middleware. Error handling via existing `errorHandler.js`.

**File: `src/server.js`** — add `app.use('/api/armory', armoryRoutes)`

---

## Step 6: Frontend API

**File: `public/js/api.js`** — add `armory` namespace:
```js
armory: {
  state:       () => request('GET',  '/api/armory/state'),
  collections: () => request('GET',  '/api/armory/collections'),
  redeem:      (data) => request('POST', '/api/armory/redeem', data),
},
```

---

## Step 7: Frontend Armory Panel

**New file: `public/js/components/armoryPanel.js`**

Overlay panel (same pattern as casket panel) opened via "Armory" button in header.

Layout:
- **Header**: "Armory Shop" title, star balance (gold), close button
- **XP section**: Level, XP progress bar, credits earned
- **Collections**: Accordion/grid of collection cards (Overpass 2024, Graphic, Sport & Field, etc.)
- **Items per collection**: Image, name, rarity border, cost in stars, "Redeem" button
- **Redeem flow**: Confirmation modal (reuse existing `confirm()` from app.js) → API call → toast on success/error → refresh state

**File: `public/index.html`**
- Add "Armory" button in `.app-header` (between username and logout)
- Add `#armory-panel` overlay div (similar to `#casket-panel`)

**File: `public/js/app.js`**
- Import `openArmoryPanel` / `closeArmoryPanel`
- Button click handler, close handler
- `loadArmoryData()` fetches state + collections

**File: `public/css/styles.css`**
- Armory panel overlay, star balance display, collection cards, item grid, redeem button, XP progress bar

---

## Step 8: Error Handling & Edge Cases

- No Armory Pass / zero balance → show info message, disable redeem buttons
- GC disconnected → disable all armory operations (same pattern as requireAuth)
- Insufficient balance → disable button, show cost vs. balance
- Failed redeem → toast error, don't update state
- Successful redeem → refresh armory state (balance decreases), reload inventory

---

## Files Summary

| Action | File |
|--------|------|
| Modify | `package.json` |
| Modify | `src/steam/SteamClient.js` (import swap + armory state + events) |
| Modify | `src/steam/casket.js` (import swap only) |
| Modify | `src/server.js` (mount armory routes) |
| Modify | `public/index.html` (armory button + panel HTML) |
| Modify | `public/js/app.js` (armory handlers) |
| Modify | `public/js/api.js` (armory API namespace) |
| Modify | `public/css/styles.css` (armory styles) |
| Create | `src/data/itemData.js` (VDF parser + items_game.txt fetcher) |
| Create | `src/steam/armory.js` (armory GC operations) |
| Create | `src/routes/armory.js` (API endpoints) |

---

## Verification

1. `npm run dev`, log in via QR
2. Click "Armory" button → panel opens
3. Star balance displayed (or 0 / "no pass" message)
4. Collections loaded with item names and images from items_game.txt
5. Click "Redeem" → confirmation → GC call → new item in inventory
6. Balance decreases after redeem
7. GC disconnect → redeem buttons disabled
8. Close/reopen panel works correctly
