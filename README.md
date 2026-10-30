# Smart Billing Trolley

A shopping trolley bills itself. An ESP32 reads an RFID tag and the load-cell weight, then posts both to this app. The server adds the product only when the scale matches the expected weight, and the trolley's web page updates live.

Three seeded trolleys are ready to use: `CART_01`, `CART_02`, and `CART_03`.

## Start the app

You need Node.js and a running Postgres. The local database is already created.

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`.env` holds one setting:

```
DATABASE_URL="postgresql://trolley:trolley@localhost:5432/smart_trolley"
```

If that database is already migrated and seeded, `npm run dev` is enough.

To run the production build instead:

```bash
npm run build
npm start
```

## Pages

### Home

[http://localhost:3000](http://localhost:3000) lists every trolley with a QR code and the direct link. Print or open that link on a phone; it is the page attached to the physical trolley.

The same page lists the products the scanner knows, including each RFID tag, price, expected weight, and tolerance.

### Trolley dashboard

Open a cart directly:

- [http://localhost:3000/cart/CART_01](http://localhost:3000/cart/CART_01)
- [http://localhost:3000/cart/CART_02](http://localhost:3000/cart/CART_02)
- [http://localhost:3000/cart/CART_03](http://localhost:3000/cart/CART_03)

The header shows:

- the cart id
- **Online** or **Offline**, based on the live connection
- **Normal** (green) or **Weight discrepancy** (red)

Three cards show the running bill in rupees, the item count, and expected weight against the scale. The dark mark on the bar is the expected weight. The bar itself is the measured weight.

The list under the cards is the bill: name, unit price, quantity, weight, subtotal, and **Remove**. Remove takes one unit off that line and checks the weight again. If the item is still on the scale, the cart turns red.

**Checkout** opens a verification window.

- When the scale matches, choose **Pay with UPI** or **Pay with card**. Payment is simulated. A reference such as `PAY-CART_01-…` appears on the page, and the cart becomes checked out. Further scans are rejected until you start a new session.
- When the scale does not match, payment stays closed. **Flag for cashier** keeps the bill and marks the cart for audit.

**New session** clears the items, the bill, and the weight flag so the trolley can be used again. Older scan logs stay in the database.

Leave this page open while you run scans. It updates without a refresh.

### Admin

[http://localhost:3000/admin](http://localhost:3000/admin) is the store view.

- **Checked-out revenue** is the sum of carts that are still checked out. Starting a new session on a cart removes that cart's total from this number.
- **Active sessions** counts carts that are still shopping, including flagged ones.
- **Weight alerts** counts carts with a weight mismatch.

Each card links to that trolley's dashboard. A flagged cart has a red border. This page is live as well.

## Products already in the database

| Tag | Product | Price | Expected weight | Tolerance |
| --- | --- | --- | --- | --- |
| `E2MILK001` | Amul Milk 500ml | ₹28 | 520 g | ±15 g |
| `E2BREAD01` | Whole Wheat Bread | ₹45 | 400 g | ±15 g |
| `E2RICE001` | Basmati Rice 1kg | ₹120 | 1000 g | ±15 g |
| `E2EGGS001` | Eggs 6 pack | ₹72 | 360 g | ±20 g |
| `E2OIL0001` | Sunflower Oil 1L | ₹160 | 920 g | ±15 g |

`measuredWeight` is the **whole cart** on the scale, in grams, not the weight of the single new item.

A scan is accepted when the scale is within the scanned product's tolerance of the cart's expected weight plus that product. A difference of exactly 15 g on milk is accepted. 16 g is rejected. Eggs allow 20 g. On a rejection the buzzer flag is returned, the product is not added, and the dashboard turns red.

At checkout the allowed difference is the largest tolerance among items already in the cart.

## Use it without the ESP32

Keep `npm run dev` running, and keep a trolley page open in the browser.

### Run the full hardware story

```bash
npm run simulate
```

The script resets the three carts, then:

1. Scans milk and bread into `CART_01` at the correct combined weight.
2. Scans rice with a weight that is too low, so the item is refused and the cart is flagged.
3. Sends an unknown tag and gets `404`.
4. Presses remove-last while the scale still includes the removed item, so the cart stays flagged.
5. Scans the remaining items at the correct weight, verifies, and pays by card.
6. Shows that another scan on a checked-out cart is rejected.
7. Checks the ±15 g boundary on `CART_02`, then flags that cart at checkout because the scale does not match.
8. Adds two milks to `CART_03`, removes one from the dashboard API, then removes the last item.

Point it at another server with:

```bash
BASE_URL=http://localhost:3000 npm run simulate
```

### Send one scan yourself

Put milk in an empty `CART_01`. The scale should read about 520 g.

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/scan \
  -H 'Content-Type: application/json' \
  -d '{"rfidTag":"E2MILK001","measuredWeight":520}'
```

A matching scan responds with:

```json
{ "status": "SUCCESS", "product": "Amul Milk 500ml", "total": 28 }
```

Add bread. The scale should now read about 920 g (520 + 400):

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/scan \
  -H 'Content-Type: application/json' \
  -d '{"rfidTag":"E2BREAD01","measuredWeight":920}'
```

Scan rice but leave the scale at 1000 g. The expected weight would be 1920 g, so this is a mismatch. Rice is not added, and the response tells the ESP32 to buzz:

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/scan \
  -H 'Content-Type: application/json' \
  -d '{"rfidTag":"E2RICE001","measuredWeight":1000}'
```

```json
{ "status": "MISMATCH", "alertBuzzer": true }
```

An unknown tag returns HTTP 404:

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/scan \
  -H 'Content-Type: application/json' \
  -d '{"rfidTag":"E2NOTREAL","measuredWeight":920}'
```

Remove the last successfully scanned item. Send the scale reading after the item is lifted. If bread was last and only milk remains, that reading is 520:

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/remove-last \
  -H 'Content-Type: application/json' \
  -d '{"measuredWeight":520}'
```

If you send the old weight and the item is still in the basket, the removal still happens and the response is `MISMATCH` with `alertBuzzer: true`.

Checkout has two steps. First confirm the weight:

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/checkout \
  -H 'Content-Type: application/json' \
  -d '{"measuredWeight":520}'
```

When that returns `"status": "VERIFIED"`, pay:

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/checkout \
  -H 'Content-Type: application/json' \
  -d '{"measuredWeight":520,"paymentMethod":"UPI"}'
```

`paymentMethod` is `UPI` or `CARD`. A weight that does not match returns `"status": "FLAGGED"` and does not take payment.

Clear a trolley and start again:

```bash
curl -s -X POST http://localhost:3000/api/cart/CART_01/reset
```

A new cart id is created the first time it is scanned or opened. For example, `POST /api/cart/CART_04/scan` creates `CART_04` and it shows up on the admin page.

## What the ESP32 should send

| Action | Request |
| --- | --- |
| Tag read | `POST /api/cart/CART_01/scan` with `{ "rfidTag", "measuredWeight" }` |
| Remove button | `POST /api/cart/CART_01/remove-last` with `{ "measuredWeight" }` |
| Final weight check | `POST /api/cart/CART_01/checkout` with `{ "measuredWeight" }` |
| Demo payment | same checkout path, adding `"paymentMethod": "UPI"` or `"CARD"` |

Buzz the buzzer when the JSON body has `"alertBuzzer": true`. On a successful scan, show `product` and `total` on the LCD. The phone page updates on its own.

## Switch the database to Neon

Replace `DATABASE_URL` in `.env` with the Neon connection string. Keep `sslmode=require` on that URL. Then run:

```bash
npx prisma migrate deploy
npm run db:seed
```

Restart `npm run dev`. The pages and the ESP32 paths stay the same.
