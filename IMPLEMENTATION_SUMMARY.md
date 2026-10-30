# Smart Billing Trolley — Implementation Summary

## What was built

A Next.js app that accepts RFID and load-cell events from an ESP32, checks the cart weight, stores the bill in Postgres, and streams the cart to a trolley page and an admin overview. Done means a scan, a mismatch, a removal, and a simulated UPI or card checkout all update the same cart a shopper sees at `/cart/[cartId]`.

## Prompt understanding

The baseline in `prompt.md` is a smart billing trolley: each physical cart has a `cartId`, the ESP32 posts tag and measured weight, and the server accepts the item only when the scale agrees with the expected weight. Confirmed choices: Next.js App Router with Prisma, Postgres, and server-sent events; unknown carts are created on scan; remove-last and checkout send `{ "measuredWeight": number }`, and checkout can also send `{ "paymentMethod": "UPI" | "CARD" }`; seed the grocery fixtures and do not add an end-to-end test suite.

## Endpoints

### POST /api/cart/:cartId/scan

Called by the ESP32 when a tag is read. Creates the cart if it does not exist.

- **Auth**: none
- **Input**: `{ "rfidTag": string, "measuredWeight": number }`
- **Returns**: `200` `{ "status": "SUCCESS", "product": string, "total": number }` when `abs(measuredWeight - (expectedWeight + product.expectedWeight))` is within that product's tolerance. The item quantity, price, and expected weight are saved and `hasMismatch` is cleared.
- **Errors**: `200` `{ "status": "MISMATCH", "alertBuzzer": true }` when the difference is greater than the product tolerance. The item is not added and the cart becomes `FLAGGED_MISMATCH`. `404` `{ "status": "UNKNOWN_TAG", "alertBuzzer": boolean }` when the tag is not in the catalog; the attempt is logged. `400` for a bad body. `409` if the cart is already checked out.
- **Notes**: publishes the cart on SSE room `cart_:cartId` and refreshes the admin stream.

### POST /api/cart/:cartId/remove-last

Removes one unit of the most recent successful scan that is still in the cart, then compares the new expected weight with the scale.

- **Auth**: none
- **Input**: `{ "measuredWeight": number }`
- **Returns**: `200` `{ "status": "SUCCESS" | "MISMATCH", "alertBuzzer": boolean, "product": string, "total": number }`
- **Errors**: `404` if the cart does not exist. `400` if there is nothing to remove. `409` if the cart is checked out.

### DELETE /api/cart/:cartId/items/:itemId

The dashboard remove button. Decrements that line by one and runs the same weight check as remove-last.

- **Auth**: none
- **Input**: `{ "measuredWeight": number }`
- **Returns**: `200` with the same shape as remove-last.
- **Errors**: `404` if the cart or item is missing. `409` if the cart is checked out.

### POST /api/cart/:cartId/checkout

Compares the scale with the cart's expected weight. The allowed difference is the largest item tolerance in the cart.

- **Auth**: none
- **Input**: `{ "measuredWeight": number, "paymentMethod"?: "UPI" | "CARD" }`
- **Returns**: `200` `{ "status": "VERIFIED", "total": number }` when the weight matches and no payment method was sent. `200` `{ "status": "CHECKED_OUT", "paymentMethod", "reference", "total" }` after a matching weight and a demo payment. `200` `{ "status": "FLAGGED", "alertBuzzer": true }` when the weight does not match; the cart is flagged and payment is not taken.
- **Errors**: `400` if the cart is empty or the body is invalid. `404` if the cart does not exist. `409` if it is already checked out.

### POST /api/cart/:cartId/reset

Starts a new session on an existing trolley. Clears items and totals and sets the cart back to `ACTIVE`. Scan logs stay.

- **Auth**: none
- **Input**: none
- **Returns**: `200` `{ "status": "RESET", "cartId": string }`
- **Errors**: `404` if the cart does not exist.

### GET /api/cart/:cartId

Returns the cart payload used by the dashboard. Creates an empty active cart if the id is new, so a QR page works before the first scan.

### GET /api/cart/:cartId/events

Server-sent events on channel `cart_:cartId`. Sends the current cart immediately, then each later update as `event: cart`.

### GET /api/admin/overview

- **Returns**: `200` `{ "totalRevenue": number, "activeSessions": number, "flaggedCarts": number, "carts": Cart[] }`
- **Notes**: revenue is the sum of `totalPrice` on carts still in `CHECKED_OUT`. Active sessions are carts that are not checked out.

### GET /api/admin/events

Server-sent events named `overview`, with the same payload as the overview endpoint.

## Data tables

### Product

- Columns: `id` cuid, `rfidTag` unique string, `name` string, `price` float, `expectedWeight` float grams, `weightTolerance` float default 15
- Keys: primary key `id`, unique `rfidTag`
- Seed: `E2MILK001` Amul Milk 500ml ₹28 / 520g, `E2BREAD01` Whole Wheat Bread ₹45 / 400g, `E2RICE001` Basmati Rice 1kg ₹120 / 1000g, `E2EGGS001` Eggs 6 pack ₹72 / 360g ±20g, `E2OIL0001` Sunflower Oil 1L ₹160 / 920g

### Cart

- Columns: `cartId` string, `status` `ACTIVE | CHECKED_OUT | FLAGGED_MISMATCH`, `totalPrice` float default 0, `totalExpectedWeight` float default 0, `currentMeasuredWeight` float default 0, `hasMismatch` boolean default false, `createdAt`, `updatedAt`
- Keys: primary key `cartId`
- Seeded carts: `CART_01`, `CART_02`, `CART_03`

### CartItem

- Columns: `id` cuid, `cartId`, `productId`, `quantity` int, `subtotal` float, `createdAt`
- Keys: primary key `id`, unique `(cartId, productId)`, foreign keys to `Cart` and `Product` with cascade delete from the cart

### ScanLog

- Columns: `id` cuid, `cartId`, `rfidTag`, `measuredWeight` float, `status` `SUCCESS | WEIGHT_MISMATCH | ITEM_REMOVED | UNKNOWN_TAG`, `timestamp`
- Keys: primary key `id`, foreign key to `Cart`, index on `(cartId, timestamp)`

## Test results

- Command: `bash scripts/simulate-esp32.sh`
- Result: passed. It covers a matching scan, a mismatch that does not add the item, an unknown tag `404`, remove-last, the ±15g boundary, flagged checkout, manual delete, empty checkout, and a card payment.
- New automated test suite: none. You asked not to add end-to-end tests.
- Confirmed failing before implementation: no. The test-first step was skipped because of that request.
- Also checked in Chrome: home, admin, and cart pages on desktop and a 390px width; live scan updates; UPI checkout; new session. `npx next build` completed successfully.

## Files changed

| File | Why |
| ---- | --- |
| prisma/schema.prisma | Product, cart, cart item, and scan log models |
| prisma/migrations/20261016192343_init/migration.sql | Initial Postgres migration |
| prisma/seed.ts | Grocery products and three carts |
| lib/cart.ts | Weight check, scan, remove, checkout, reset |
| lib/realtime.ts | In-process SSE rooms |
| lib/sse.ts | Event stream response |
| app/api/cart/[cartId]/** | Hardware and dashboard routes |
| app/api/admin/** | Store overview and live stream |
| app/cart/[cartId]/page.tsx | Trolley dashboard |
| app/admin/page.tsx | Multi-cart overview |
| app/page.tsx | Trolley links, QR codes, and product list |
| scripts/simulate-esp32.sh | ESP32 curl simulation |
| .env.example | Local database URL to swap for Neon |

## Decisions made beyond the prompt

- Server-sent events instead of Socket.io, so the app stays on the Next.js server without a custom Socket.io process.
- A mismatch does not add the item. The cart is flagged and the buzzer flag is returned.
- Checkout tolerance is the largest `weightTolerance` among items currently in the cart, so the eggs ±20g allowance still applies at payment.
- An unknown tag returns 404 and is logged. If that reading disagrees with the current expected weight by more than 15g, the cart is flagged.
- Scanning or opening a cart id that does not exist creates an empty `ACTIVE` cart. Remove, checkout, and reset do not create one.
- A checked-out cart rejects new scans with 409 until "New session" resets it.
- Manual remove decrements one unit and rechecks the last known scale reading.
- Revenue on the admin page is the sum of carts that are still checked out. Starting a new session clears that cart, so its total leaves the revenue figure.
- Live updates are in memory for one Node process. That matches `npm run dev` and `npm start` on a single server.

## Deviations from the user's answers

- None. Sample rows are the ones proposed, and no end-to-end test suite was added.

## Outstanding / needs review

- `.env` points at `postgresql://trolley:trolley@localhost:5432/smart_trolley`. Replace `DATABASE_URL` with the Neon URL and run `npx prisma migrate deploy`.
- The database currently has demo activity from verification: `CART_01` checked out at ₹145, `CART_02` flagged, `CART_03` empty. `npm run simulate` resets those three carts and runs the story again.
- Please review this summary against `prompt.md` and say if the checkout tolerance, unknown-tag flag, or new-session reset should work differently.
