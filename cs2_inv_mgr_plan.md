# CS2 Inventory Manager — Implementation Plan

## Context

Build a local web application that lets a user log into their Steam account and manage their CS2 inventory — specifically viewing items and moving skins in/out of storage units (caskets) — without launching CS2.

**Key constraint:** Storage unit operations (view contents, add/remove items) are only available through the CS2 Game Coordinator protocol, not the standard Steam Web API. This requires Node.js libraries `steam-user` and `globaloffensive` (by DoctorMcKay).

## Tech Stack

- **Runtime:** Node.js
- **Backend:** Express (REST API + static file server)
- **Steam libraries:** `steam-user`, `steam-session`, `globaloffensive`, `steamcommunity`, `qrcode`
- **Frontend:** Vanilla HTML/CSS/JS (ES modules, no build step)
- **No database** — GC inventory is the source of truth; all state lives in memory

## Project Structure

```
cs2_inv_mgr/
├── package.json
├── .env
├── .gitignore
├── src/
│   ├── server.js                 # Express entry point
│   ├── steam/
│   │   ├── SteamClient.js        # Wraps steam-user + globaloffensive
│   │   ├── inventory.js          # Fetch & merge GC + community inventory
│   │   └── casket.js             # Storage unit operations + operation queue
│   ├── routes/
│   │   ├── auth.js               # Login, Steam Guard, logout, status
│   │   ├── inventory.js          # GET inventory
│   │   └── casket.js             # Casket contents, add, remove
│   ├── middleware/
│   │   └── requireAuth.js        # Gate routes behind active GC session
│   └── utils/
│       └── itemFormatter.js      # Transform GC items → frontend-friendly JSON
├── public/
│   ├── index.html
│   ├── css/
│   │   └── styles.css            # Steam-inspired dark theme
│   └── js/
│       ├── app.js                # SPA routing & state
│       ├── api.js                # Fetch wrappers
│       └── components/
│           ├── loginForm.js
│           ├── inventoryGrid.js
│           ├── itemCard.js
│           └── casketPanel.js    # Split-panel storage unit manager
```

## Implementation Steps

### Step 1: Project Setup
- `npm init`, install deps: `steam-user`, `globaloffensive`, `steam-session`, `steamcommunity`, `express`, `express-session`, `helmet`, `express-rate-limit`, `dotenv`, `qrcode`
- Create `.gitignore`, `.env` (SESSION_SECRET, PORT)
- Create `src/server.js` — Express app bound to `127.0.0.1` only, session middleware, helmet, static serving from `public/`

### Step 2: Steam Authentication (3 methods)
- **`src/steam/SteamClient.js`** — singleton class managing all auth flows:
  - Creates `SteamUser` and `GlobalOffensive` instances
  - All auth paths end the same way: obtain a `refreshToken` → `steamUser.logOn({ refreshToken })` → `gamesPlayed([730])` → GC connects
  - `logout()` → `steamUser.logOff()`

- **Method 1 — QR Code (recommended, no credentials needed):**
  - `startQRLogin()` → creates `LoginSession(EAuthTokenPlatformType.SteamClient)`, calls `session.startWithQR()`
  - Returns `{ qrChallengeUrl }` — backend converts this to a data URL using the `qrcode` library
  - Frontend displays the QR image; user scans with Steam mobile app
  - `steam-session` auto-polls; emits `remoteInteraction` (scanned) then `authenticated` (approved)
  - On `authenticated` → get `refreshToken` → `steamUser.logOn()` → GC connects
  - QR codes expire — listen for `timeout` event and generate a new one

- **Method 2 — Username/Password + Steam Guard:**
  - `startCredentialLogin(username, password)` → `LoginSession.startWithCredentials()`
  - If Steam Guard required → returns `{ requiresGuard: true, guardType }` (email/device/app)
  - `submitGuardCode(code)` → completes login → `refreshToken` → `steamUser.logOn()`

- **Method 3 — Browser Token (`webLogOnToken`):**
  - User navigates to `https://steamcommunity.com/chat/clientjstoken` while logged into Steam in their browser
  - Copies the `token` value from the JSON response
  - `startTokenLogin(token, steamId)` → calls `steamUser.logOn({ steamID, webLogOnToken })`
  - Skips `steam-session` entirely; logs directly into `steam-user`
  - Note: `webSession` event won't auto-fire; must call `steamUser.webLogOn()` explicitly after `loggedOn`

- **`src/routes/auth.js`** — endpoints:
  - `POST /api/auth/login` → `{ username, password }` → 200 or 202 (needs guard)
  - `POST /api/auth/qr` → starts QR flow, returns `{ qrDataUrl }` (base64 PNG)
  - `GET /api/auth/qr/status` → poll for QR scan result → `{ status: 'waiting' | 'scanned' | 'authenticated' }`
  - `POST /api/auth/steam-guard` → `{ code }` → 200
  - `POST /api/auth/token` → `{ token, steamId }` → 200
  - `GET /api/auth/status` → `{ loggedIn, connectedToGC, steamId, username }`
  - `POST /api/auth/logout`

### Step 3: Inventory Fetching
- **`src/steam/inventory.js`**:
  - After GC connects, `csgo.inventory` has all items as raw GC objects
  - Also fetch community inventory via `steamcommunity.getUserInventoryContents()` (using web session cookies) to get item names, images, tags
  - Merge by asset ID: GC data (float, casket_id, stickers) + community data (name, image URL, rarity, type)
  - Storage units identified by `def_index === 1201`
- **`src/utils/itemFormatter.js`** — maps raw items to `{ id, name, imageUrl, rarity, exterior, float, statTrak, stickers, inCasket }`
- **`src/routes/inventory.js`** — `GET /api/inventory` → `{ items: [...], storageUnits: [...] }`

### Step 4: Storage Unit Operations
- **`src/steam/casket.js`**:
  - `getCasketContents(csgo, casketId)` → Promise wrapper around `csgo.getCasketContents()`
  - `addItemToCasket(csgo, casketId, itemId)` → calls `csgo.addToCasket()`, listens for `CasketAdded` notification
  - `removeItemFromCasket(csgo, casketId, itemId)` → calls `csgo.removeFromCasket()`, listens for `CasketRemoved` notification
  - `OperationQueue` class — 1-second delay between operations for bulk moves
  - Timeout handling (15s per operation)
  - Pre-checks: casket full (1000 items max), inventory full
- **`src/routes/casket.js`**:
  - `GET /api/caskets/:id/contents`
  - `POST /api/caskets/:id/add` → `{ itemId }`
  - `POST /api/caskets/:id/remove` → `{ itemId }`

### Step 5: Frontend — Login
- **`public/index.html`** — SPA shell with view containers
- **`public/js/components/loginForm.js`** — tabbed login with 3 methods:
  - **QR Code tab** (default): displays QR image, "Waiting for scan..." status, auto-refreshes on expiry
  - **Credentials tab**: username/password form, dynamic Steam Guard code input after submission
  - **Token tab**: instructions to visit `steamcommunity.com/chat/clientjstoken`, paste token + Steam ID fields
- **`public/js/app.js`** — state management, view switching (login → inventory)
- **`public/js/api.js`** — fetch helpers with error handling

### Step 6: Frontend — Inventory View
- **`public/js/components/inventoryGrid.js`** — CSS Grid of item cards, filter bar (search, type, rarity, sort)
- **`public/js/components/itemCard.js`** — item image, name, exterior, float, StatTrak badge, rarity color border
- Storage units displayed in a separate section with name + item count
- Steam CDN images: `https://community.akamai.steamstatic.com/economy/image/{icon_url}`
- Steam-inspired dark theme (dark blue `#1b2838`, accent `#66c0f4`)

### Step 7: Frontend — Storage Unit Manager
- **`public/js/components/casketPanel.js`** — split-panel view:
  - Left: main inventory items (filterable)
  - Right: selected storage unit contents
  - Click item in inventory → "Move to Storage Unit" action
  - Click item in casket → "Move to Inventory" action
  - Confirmation before moves
  - Progress indicator for operations
  - Item count display (X / 1000)

### Step 8: Error Handling & Polish
- Connection status banner (GC connected/disconnected)
- Toast notifications for operation results
- Loading spinners during operations
- Auto-reconnect on GC disconnect (re-call `gamesPlayed([730])`)
- Rate limit login attempts (5/min via `express-rate-limit`)
- Graceful error messages for: invalid credentials, wrong guard code, timeouts, full casket/inventory

## Security
- Server binds to `127.0.0.1` only (never exposed to network)
- Passwords held in memory only during login, discarded after
- `helmet` for security headers
- `httpOnly` + `sameSite: strict` session cookies
- No credentials logged to console/files

## Verification
1. Run `npm start`, open `http://localhost:3000`
2. Test login via each method:
   - QR code: scan with Steam mobile app, verify auto-login completes
   - Credentials: enter username/password, complete Steam Guard, verify login
   - Token: paste clientjstoken + Steam ID, verify login
3. Verify inventory loads with item images, names, and details
4. Click a storage unit → verify contents load
5. Move an item from inventory into a storage unit → verify it disappears from inventory and appears in casket
6. Move an item from storage unit to inventory → verify the reverse
7. Test error cases: wrong password, wrong guard code, expired QR, GC disconnect
