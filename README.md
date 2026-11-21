# Smart Billing Trolley 🛒⚡
### RFID & Weight-Sensor Based Intelligent Retail Checkout System
**Instrumentation & Control Systems · Team 2**  
**Indian Institute of Technology Indore (IIT Indore)**

---

## 👥 Project Team
* **Boddu Kunal** (240003020)
* **Harshith Pasupuleti** (240003034)
* **Dantuluri Sai Harshit Varma** (240003024)
* **Kathi Tagore Chandra** (240003039)
* **Nanavath Vishwanath Rathod** (240003049)

**Repository**: [GitHub — RFID-and-Weight-Sensor-Based-Smart-Billing](https://github.com/Yagami-light45/RFID-and-Weight-Sensor-Based-Smart-Billing)

---

## 📌 Executive Summary & Problem Solved

Traditional supermarket checkouts require manual scanning of every individual item at a central billing counter. This creates severe checkout queues during peak hours, increases labor overhead, allows accidental miss-scans or theft, and leaves customers without a real-time running total until the final receipt is printed.

The **Smart Billing Trolley** eliminates checkout queues by enabling in-cart automated billing. By combining **13.56 MHz RFID tag identification** with a **high-precision 24-bit strain-gauge load cell**, the system achieves **closed-loop dual verification**:
1. **RFID Reading** confirms which item was added or removed.
2. **Continuous Load-Cell Weighing** physically verifies that the item placed in the basket matches its expected catalogue weight.
3. **Live Cloud Synchronization** pushes instantaneous cart and billing updates to the customer's smartphone and store cashier dashboard over **Server-Sent Events (SSE)**.

---

## 🚀 Key Features

### 1. Dual-Sensor Anti-Theft Verification
* **Closed-Loop Cross Checking**: An item is only validated when both RFID identification and physical weight delta match within designated tolerances (e.g., $\pm 15\text{ g}$).
* **Instant Discrepancy Detection**: Unscanned items placed in the basket or scanned items withheld from the basket trigger an alert buzzer flag on the ESP32 and visually flag the cart in orange/red on customer and cashier screens.
* **Item-Specific Weight Tolerances**: Configurable weight boundaries per item (e.g., standard items $\pm 15\text{ g}$, delicate/natural produce like eggs $\pm 20\text{ g}$).

### 2. Embedded Hardware & Firmware Precision
* **ESP32 DevKit V1 Microcontroller**: High-speed dual-core processing driving Wi-Fi HTTP client communication, SPI RFID reading, I2C LCD interfacing, and load cell signal acquisition.
* **HX711 24-bit ADC**: Precision analog-to-digital bridge converter digitizing micro-volt strain gauge variations with exceptional resolution.
* **Real-Time Signal Filtering**: Firmware implements exponential smoothing filters ($\alpha = 0.90$) and a $4\text{ g}$ deadband zero-clamp to eliminate baseline thermal drift and bench vibrations.
* **16×2 Character LCD Screen**: Live onboard feedback showing current basket weight, scanned tag UID, product name, and total item count directly on the trolley.
* **Movement & Stability Detection**: Firmware dynamically waits for basket movement to settle before capturing stable weight and posting data to the cloud.

### 3. Real-Time Customer Web Dashboard (`/[cartId]`)
* **Instant Trolley Access via QR Code**: Each physical trolley carries a custom QR code label that instantly opens that cart’s live web dashboard on any mobile smartphone.
* **Server-Sent Events (SSE) Live Feed**: Cart items, quantities, weights, and subtotals update instantaneously without requiring page refreshes.
* **Live Running Total & GST Calculation**: Continuous calculation of subtotal, 5% standard GST, and final payable amount.
* **Item Removal Management**: Shoppers can delete items directly from the web interface or via an onboard hardware remove button.
* **Digital Tax Invoice Generation**: Produces a clean, formatted, printable/downloadable digital bill and unique invoice number (`BILL-<cartId>-XXXXXX`).

### 4. Enterprise Cashier & Admin Board (`/admin`)
* **Fleet Overview**: Live monitoring of all store trolleys simultaneously with active status, current weights, and session states.
* **Instant Fraud & Mismatch Alerts**: Flagged carts are highlighted with visual alerts, alerting cashiers to verify item contents before releasing carts.
* **Counter Payment Confirmation**: Cashiers finalize bills with flexible physical counter payment options:
  * **Cash** (with cash drawer reference notes)
  * **Card** (physical store POS terminal authorization code)
  * **UPI** (in-store counter QR code transaction UTR)
* **Revenue & Sales Analytics**: Real-time aggregation of store revenue, active shopping sessions, pending payments, and historical transaction logs.

---

## 📐 System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHYSICAL SMART TROLLEY                          │
│                                                                        │
│   ┌────────────────────┐                   ┌───────────────────────┐   │
│   │  MFRC522 RFID      │                   │ 4-Wire Strain Gauge   │   │
│   │  Reader (13.56MHz) │                   │ Load Cell (0-5 kg)    │   │
│   └─────────┬──────────┘                   └───────────┬───────────┘   │
│             │ SPI                                      │ Bridge        │
│             │                                          ▼               │
│             │                              ┌───────────────────────┐   │
│             │                              │ HX711 24-Bit ADC      │   │
│             │                              └───────────┬───────────┘   │
│             ▼                                          │ Serial DT/SCK │
│   ┌────────────────────────────────────────────────────▼───────────┐   │
│   │                     ESP32 DevKit V1 Board                      │   │
│   │    - Real-Time Exponential Filter (α = 0.90)                   │   │
│   │    - Movement & Stability Settling Engine                      │   │
│   │    - HTTP Client (JSON Scans, Retries, Idempotent Events)      │   │
│   └───────────────┬────────────────────────────────────┬───────────┘   │
│                   │ I2C Bus                            │ Wi-Fi         │
│                   ▼                                    │ HTTP POST     │
│   ┌───────────────────────────────┐                    │               │
│   │ 16×2 I2C LCD Onboard Display  │                    │               │
│   └───────────────────────────────┘                    │               │
└────────────────────────────────────────────────────────┼───────────────┘
                                                         │
                                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      CLOUD & BACKEND PLATFORM                          │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Next.js 16 REST APIs + Server-Sent Events (SSE) Engine         │   │
│   │   - Weight Tolerance Verification Engine                       │   │
│   │   - Active Shopping Session Management                         │   │
│   │   - Tax & Dynamic Billing Engine                               │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ Prisma ORM                         │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ PostgreSQL Database (Neon Cloud / Local)                       │   │
│   │   - Models: Cart, Product, Session, CartItem, Event, Payment   │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ Real-Time Broadcast (SSE)          │
│                   ┌───────────────┴───────────────┐                    │
│                   ▼                               ▼                    │
│   ┌───────────────────────────────┐ ┌──────────────────────────────┐   │
│   │ Customer Mobile Dashboard     │ │ Cashier / Admin Store Board  │   │
│   │ (Live Running Bill & QR view) │ │ (Fleet Monitor & Settlement) │   │
│   └───────────────────────────────┘ └──────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🧮 Mathematical Modeling & Signal Processing

The firmware and backend use six core equations to guarantee weighing accuracy and stability:

### 1. Raw ADC Counts to Grams Conversion
$$W = \frac{R - R_0}{k}$$
* $R$: Current raw 24-bit reading from HX711 ADC.
* $R_0$: Tare offset calculated from a 50-sample moving average with an empty basket.
* $k$: Scale calibration factor (Bench calibrated to $-63.09\text{ counts/gram}$).

### 2. First-Order Exponential Smoothing Filter
$$W_f = \alpha W + (1 - \alpha) W'_f$$
* $\alpha = 0.90$: Smoothing coefficient prioritizing responsive updates while filtering out mechanical noise.
* $W$: Mean of 3 consecutive raw measurements.
* $W'_f$: Filtered weight output from previous cycle.

### 3. Deadband Zero-Clamping
$$|W_f| < 4\text{ g} \implies W_{\text{output}} = 0\text{ g}$$
Suppresses baseline mechanical jitter and small temperature drift when the basket is empty.

### 4. Cumulative Expected Weight
$$W_{\text{expected}} = \sum_{i=1}^{n} w_i + w_{\text{new}}$$
The catalogue weight of all validated items currently in the shopping session plus the newly scanned item.

### 5. Dual Verification Tolerance Test
$$|W_{\text{measured}} - W_{\text{expected}}| \le \text{tolerance}$$
* $\text{tolerance}$: Defined per product in catalogue (standard: $\pm 15\text{ g}$, eggs: $\pm 20\text{ g}$).
* If condition is satisfied: Item is confirmed as **Weight OK**.
* If discrepancy detected: Item is flagged as **Weight Mismatch**, triggering the ESP32 buzzer signal and web dashboard alert.

### 6. Billing Formula with Tax
$$\text{Final Total} = 1.05 \times \sum_{i=1}^{n} (q_i \times p_i) - D$$
Calculates subtotal of quantity $\times$ unit price, applies standard 5% GST, and subtracts any promotional discounts ($D$).

---

## 🔌 Hardware Setup & Pin Mapping

| Component | Module Pin | ESP32 Pin | Function / Protocol | Voltage |
|---|---|---|---|---|
| **RC522 RFID Reader** | SDA / SS | GPIO 5 | SPI Slave Select | 3.3 V |
| | SCK | GPIO 18 | SPI Clock | 3.3 V |
| | MOSI | GPIO 23 | Master Out Slave In | 3.3 V |
| | MISO | GPIO 19 | Master In Slave Out | 3.3 V |
| | RST | GPIO 27 | Hardware Reset | 3.3 V |
| | GND & 3.3V | GND & 3V3 | Power Supply | 3.3 V |
| **HX711 24-Bit ADC** | DT (Data) | GPIO 32 | Serial Data Output | 3.3 V |
| | SCK (Clock) | GPIO 33 | Serial Clock Input | 3.3 V |
| | VCC & GND | 3V3 & GND | Power Supply | 3.3 V |
| | E+, E-, A+, A- | Load Cell | 4-Wire Wheatstone Bridge | Excitation |
| **16×2 LCD Display** | SDA | GPIO 21 | I2C Data Line | 5 V (VIN) |
| | SCL | GPIO 22 | I2C Clock Line | 5 V (VIN) |
| | VCC & GND | VIN & GND | I2C Backpack Power | 5 V |

> **Wiring Note**: Ensure a common ground connection across ESP32, RC522, HX711, and the LCD backpack. RC522 and HX711 logic must be powered from the 3.3V rail.

---

## 📦 Seeded Product Catalogue

The system comes pre-configured with everyday supermarket items ready for testing:

| Product Name | RFID Tag UID | Price (₹) | Expected Weight (g) | Weight Tolerance (g) |
|---|---|---|---|---|
| **Amul Milk 500ml** | `E2MILK001` | ₹28.00 | 520 g | $\pm 15\text{ g}$ |
| **Whole Wheat Bread** | `E2BREAD01` | ₹45.00 | 400 g | $\pm 15\text{ g}$ |
| **Basmati Rice 1kg** | `E2RICE001` | ₹120.00 | 1000 g | $\pm 15\text{ g}$ |
| **Farm Fresh Eggs (6-pack)**| `E2EGGS001` | ₹72.00 | 360 g | $\pm 20\text{ g}$ |
| **Sunflower Cooking Oil 1L** | `E2OIL0001` | ₹160.00 | 920 g | $\pm 15\text{ g}$ |

---

## 🛠️ Installation & Setup Instructions

### Prerequisites
* **Node.js**: v18.0.0 or later installed
* **PostgreSQL**: Local Postgres instance or [Neon Cloud PostgreSQL](https://neon.tech)
* **Arduino IDE** (if uploading to physical ESP32): ESP32 board support package installed

---

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/Yagami-light45/RFID-and-Weight-Sensor-Based-Smart-Billing.git
cd RFID-and-Weight-Sensor-Based-Smart-Billing
npm install
```

---

### Step 2: Configure Environment Variables
Create a `.env` file in the project root:
```env
# For local PostgreSQL:
DATABASE_URL="postgresql://username:password@localhost:5432/smart_trolley"

# For Neon Serverless Cloud PostgreSQL:
# DATABASE_URL="postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

---

### Step 3: Database Migration & Seeding
Initialize the database schema and populate the product catalogue:
```bash
# Push database migrations
npx prisma migrate dev --name init

# Seed database with sample products and trolleys (CART_01, CART_02, CART_03)
npm run db:seed
```

---

### Step 4: Run the Web Application
```bash
# Start Next.js development server
npm run dev
```
Open your browser and navigate to:
* **Store Home & Trolley Selector**: [http://localhost:3000](http://localhost:3000)
* **Trolley 01 Dashboard**: [http://localhost:3000/CART_01](http://localhost:3000/CART_01)
* **Cashier & Store Admin Portal**: [http://localhost:3000/admin](http://localhost:3000/admin)

To run a production build:
```bash
npm run build
npm start
```

---

### Step 5: Flash ESP32 Firmware (`esp32.ino`)
1. Open `esp32.ino` in the Arduino IDE.
2. Install required Arduino libraries via Library Manager:
   * `MFRC522` by GithubCommunity
   * `HX711` by Bogdan Necula
   * `LiquidCrystal_I2C` by Frank de Brabander
3. Configure your network credentials and server IP in `esp32.ino`:
   ```cpp
   static const char* WIFI_SSID     = "Your_WiFi_SSID";
   static const char* WIFI_PASSWORD = "Your_WiFi_Password";
   static const char* SERVER_IP     = "192.168.1.100"; // Local IP of computer running Next.js
   static const uint16_t SERVER_PORT = 3000;
   static const char* CART_ID       = "CART_01";
   ```
4. Select board **ESP32 Dev Module**, choose the correct COM port, and click **Upload**.

---

## ⚖️ Load Cell Calibration Procedure

1. **Empty Basket Power-On**: Power on the ESP32 with the weighing basket completely empty. Allow a 10-second warmup period for the strain gauge bridge to thermally stabilize.
2. **Auto-Tare**: The firmware automatically averages 50 readings to establish baseline zero tare offset ($R_0$).
3. **Reference Mass Loading**: Place a known calibration mass (e.g. $m = 230\text{ g}$) in the basket.
4. **Determine Scale Factor**:
   $$k = \frac{R - R_0}{m}$$
   * Example: $(14,510\text{ counts}) / (230\text{ g}) = 63.09\text{ counts/gram}$.
5. **Verification**: Place secondary test weights. If readings are within $\pm 2\text{ g}$, the scale is calibrated.

---

## 🧪 Testing & Simulation (Without Hardware)

You can fully test the complete hardware workflow, scan logic, and cashier approvals using the built-in simulator scripts or `curl`.

### Option A: Run Full Automated Simulation
```bash
npm run simulate
```
This automated simulation:
1. Resets active sessions on `CART_01`, `CART_02`, and `CART_03`.
2. Simulates placing Milk and Bread into `CART_01` at matching weights.
3. Tests weight mismatch rejection and alert buzzer triggering.
4. Tests unknown tag rejection with HTTP 404 handling.
5. Verifies item removal and final invoice generation.
6. Simulates cashier counter confirmation.

### Option B: Manual API Scans via `curl`

* **1. Scan Milk (520 g) into Cart 01**:
  ```bash
  curl -X POST http://localhost:3000/api/cart/CART_01/scan \
    -H "Content-Type: application/json" \
    -d '{"rfidUid":"E2MILK001","measuredWeight":520}'
  ```
  *Response*:
  ```json
  { "status": "SUCCESS", "product": "Amul Milk 500ml", "total": 28.00 }
  ```

* **2. Scan Bread (400 g) — Cumulative Weight Now 920 g**:
  ```bash
  curl -X POST http://localhost:3000/api/cart/CART_01/scan \
    -H "Content-Type: application/json" \
    -d '{"rfidUid":"E2BREAD01","measuredWeight":920}'
  ```

* **3. Simulate Weight Mismatch**:
  ```bash
  curl -X POST http://localhost:3000/api/cart/CART_01/scan \
    -H "Content-Type: application/json" \
    -d '{"rfidUid":"E2RICE001","measuredWeight":1000}'
  ```
  *Response*:
  ```json
  { "status": "MISMATCH", "alertBuzzer": true, "message": "Weight mismatch detected" }
  ```

* **4. Generate Final Bill**:
  ```bash
  curl -X POST http://localhost:3000/api/cart/CART_01/bill \
    -H "Content-Type: application/json" \
    -d '{"measuredWeight":920}'
  ```

* **5. Cashier Physical Counter Confirmation**:
  ```bash
  curl -X POST http://localhost:3000/api/admin/bills/CART_01/confirm \
    -H "Content-Type: application/json" \
    -d '{"paymentMethod":"UPI","reference":"UPI_REF_987654321"}'
  ```

---

## 🌐 API Reference Summary

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/cart/:cartId/scan` | Hardware scan input; validates weight tolerance and updates cart |
| `POST` | `/api/cart/:cartId/remove-last` | Removes previous item and verifies weight reduction |
| `DELETE` | `/api/cart/:cartId/items/:itemId` | Deletes a specific line item via web interface |
| `POST` | `/api/cart/:cartId/bill` | Verifies final cart weight, calculates 5% GST, and creates bill |
| `POST` | `/api/cart/:cartId/reset` | Resets trolley session for the next shopper |
| `GET` | `/api/cart/:cartId` | Fetches active trolley state, items, and billing totals |
| `GET` | `/api/cart/:cartId/events` | Server-Sent Events stream for live mobile cart synchronization |
| `GET` | `/api/admin/overview` | Retrieves store statistics, fleet status, and sales history |
| `GET` | `/api/admin/events` | Server-Sent Events stream for live cashier monitoring board |
| `POST` | `/api/admin/bills/:cartId/confirm` | Cashier settlement confirming Cash, Card, or UPI payment |

---

## 🌟 Future Opportunities & Roadmap

* **Continuous Multi-Point Calibration**: Dynamic multi-point calibration tables with active temperature compensation for industrial cold-chain environments.
* **Smart Autonomous Removal Detection**: Machine learning weight profile analysis to automatically detect and identify un-scanned item removals.
* **On-Trolley Rechargeable Battery Station**: Integrated Li-ion power pack with inductive charging dock stations at trolley return bays.
* **Barcode & Computer Vision Hybrid Support**: Secondary overhead mini-camera verification for high-density mixed retail baskets.
* **Enterprise Multi-Store Fleet Management**: Centralized cloud orchestration supporting multi-store retail chains with distributed cashier terminals.

---
