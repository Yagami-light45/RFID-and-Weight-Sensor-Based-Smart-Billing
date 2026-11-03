# Smart Billing Trolley — Implementation Summary

## 1. System Overview

A full-stack Next.js application for an RFID and Load-Cell Sensor Based Smart Billing Trolley. The system connects physical hardware (ESP32 microcontrollers with RFID readers and load cells) to a PostgreSQL/NeonDB database via Prisma ORM, providing real-time Server-Sent Events (SSE) updates to customer mobile screens and cashier counters.

### Core Lifecycle

1. **Shopping Session (`ACTIVE`)**:
   - Customer scans the trolley QR code or visits `/[cartId]`.
   - Items added/removed via RFID scans and load-cell weight sensors.
   - Real-time weight verification against product weight tolerance to prevent shoplifting or unscanned items.
2. **Final Bill Generation (`BILL_GENERATED` / `PAYMENT_PENDING`)**:
   - Customer taps **"Generate Final Bill"** on their mobile device.
   - Server verifies scale weight against total expected weight.
   - Calculates subtotal, 5% GST tax, and final payable amount.
   - Generates a unique Bill Number (`BILL-<cartId>-...`).
   - Renders a printable/downloadable Tax Invoice on customer's screen.
   - **Does NOT mark the session as paid or completed**.
   - Clear customer instruction: *"Please proceed to the billing counter to complete your payment."*
3. **Physical Counter Payment (`COMPLETED`)**:
   - All payments take place **physically at the store's billing counter**.
   - Accepted methods: **Cash**, **Card** (store's physical POS terminal), or **UPI** (customer scans physical counter QR code using Google Pay / PhonePe / Paytm).
   - Cashier reviews pending bills, verifies sensor weight match, selects payment method, enters optional transaction/auth reference, and clicks **"Confirm & Complete Bill"**.
   - Bill marked `PAID`, session marked `COMPLETED`, and real-time SSE updates customer receipt.

---

## 2. Strict Payment & Architecture Boundaries

- **No Online Payment Processing**: The website does NOT collect or process money online.
- **No Online UPI Gateways or QR Codes**: No payment gateway (Razorpay/Stripe), dynamic UPI links, or customer-facing UPI QR codes are rendered on the customer shopping site.
- **Physical Verification Only**: Payment method and payment status are recorded strictly when the cashier confirms physical payment at the counter.

---

## 3. Database Architecture (Prisma & NeonDB)

### Entities

1. **Cart**:
   - `cartId` (Unique ID, e.g. `CART_01`)
   - `cartCode` (QR code slug)
   - `operationalStatus` (`ACTIVE`, `MAINTENANCE`, `INACTIVE`)
   - Relation to `ShoppingSession[]`
2. **Product**:
   - `rfidUid` (Unique RFID tag UID, e.g. `E2MILK001`)
   - `name`, `price`, `expectedWeight` (grams), `weightTolerance` (grams), `available`
3. **ShoppingSession**:
   - `id` (Session UUID)
   - `cartId`
   - `status` (`ACTIVE`, `BILL_GENERATED`, `PAYMENT_PENDING`, `COMPLETED`, `ABANDONED`)
   - `startedAt`, `completedAt`
   - `totalPrice`, `totalExpectedWeight`, `currentMeasuredWeight`, `hasMismatch`
   - Relations to `CartItem[]`, `ScanEvent[]`, and `Transaction?`
4. **CartItem**:
   - `id`, `sessionId`, `productId`, `quantity`
   - `productNameSnapshot`, `unitPriceSnapshot`, `expectedWeightSnapshot`
   - `subtotal`
5. **ScanEvent**:
   - Idempotent scan log with `eventId`, `sessionId`, `rfidUid`, `action` (`ADD` | `REMOVE`), `measuredWeight`, `status` (`SUCCESS` | `MISMATCH` | `UNKNOWN_TAG`), `alertBuzzer`
6. **Transaction**:
   - `id`, `sessionId` (Unique foreign key)
   - `billNumber` (Unique reference ID)
   - `subtotal`, `tax` (5% GST), `discount`, `finalTotal`
   - `billStatus` (`PENDING`, `PAID`, `CANCELLED`)
   - `paymentMethod` (`CASH`, `CARD`, `UPI` — nullable until cashier confirmation)
   - `paymentStatus` (`PENDING`, `PAID`)
   - `reference` (Cash drawer note, POS auth code, or UPI UTR)
   - `cashierConfirmedAt`, `createdAt`, `updatedAt`

---

## 4. API Endpoints

### Customer & Hardware Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/cart/:cartId/scan` | Hardware ESP32 RFID scan with measured weight. Verifies weight tolerance and adds/updates item. |
| `POST` | `/api/cart/:cartId/remove-last` | Hardware/button remove-last event with scale reading. |
| `DELETE` | `/api/cart/:cartId/items/:itemId` | Customer UI remove button for a line item. |
| `POST` | `/api/cart/:cartId/bill` | Generates final bill, verifies load-cell weight, calculates taxes, sets session to `PAYMENT_PENDING`. |
| `POST` | `/api/cart/:cartId/reset` | Resets trolley to a new active session for the next shopper. |
| `GET` | `/api/cart/:cartId` | Returns current cart, active session, items, weight status, and transaction details. |
| `GET` | `/api/cart/:cartId/events` | Server-Sent Events stream (`cartChannel`) for live mobile updates. |

### Cashier / Admin Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/overview` | Returns total collected revenue, active sessions count, pending bills list, and completed billing history. |
| `GET` | `/api/admin/events` | Server-Sent Events stream (`ADMIN_CHANNEL`) for real-time cashier dashboard updates. |
| `POST` | `/api/admin/bills/:cartId/confirm` | Cashier physical counter confirmation. Accepts `{ paymentMethod: "CASH" \| "CARD" \| "UPI", reference?: string }`, marks bill `PAID`, completes session. |

---

## 5. Frontend Interfaces

### Customer Mobile Interface (`components/cart-dashboard.tsx`)
- **Live Cart View**: Real-time item list, unit prices, subtotal, running total, expected vs measured weight gauge, and weight discrepancy badge.
- **Generate Final Bill Button**: Initiates bill calculation and weight validation.
- **Tax Invoice & Bill View**:
  - Displays Bill Number, Date & Time, Cart & Session IDs.
  - Sensor verification badge (Expected vs Measured weight).
  - Itemized table with quantities, prices, weights, and subtotals.
  - Subtotal, 5% GST tax, and Final Payable Amount.
  - **"Print / Save PDF Bill"** action formatted for standard receipt printing via `@media print`.
  - Prominent banner: *"Please proceed to the billing counter to complete your payment."*
- **Live Completed View**: Automatically updates when cashier confirms payment at the counter, showing confirmation timestamp, payment method, and receipt.

### Cashier Console (`components/admin-board.tsx`)
- **Overview Metrics**: Collected revenue, pending counter bills, active shopping carts, and weight mismatches.
- **Pending Bills Tab**: Real-time list of carts awaiting physical payment with **"Verify & Collect Payment"** button.
- **Cashier Verification & Payment Modal**:
  - Itemized product inspection and sensor weight verification.
  - Payment method selector: **Cash** (physical notes), **POS Card** (card terminal), or **Store UPI QR** (physical counter QR).
  - Optional reference note (e.g. POS approval code, UPI UTR).
  - Action to record payment and complete billing.
- **All Trolleys Tab**: Live monitor of all store carts in aisles.
- **Completed Billing History Tab**: Audited history of all cashier-confirmed transactions.

---

## 6. Migration History

1. `20261016192343_init`: Initial baseline tables.
2. `20261031000000_final_bill_and_physical_payment`:
   - Adds `BillStatus` enum (`PENDING`, `PAID`, `CANCELLED`).
   - Adds `BILL_GENERATED` and `PAYMENT_PENDING` to `SessionStatus`.
   - Adds `billNumber` (unique), `billStatus`, `paymentStatus`, `cashierConfirmedAt`, and audit timestamps to `Transaction`.
   - Applied to NeonDB PostgreSQL via `npx prisma migrate deploy`.
