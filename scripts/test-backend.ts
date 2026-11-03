import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function runTest() {
  console.log("==================================================");
  console.log("   SMART TROLLEY BACKEND API INTEGRATION TEST     ");
  console.log("==================================================");
  console.log(`Target: ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  async function testStep(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err: unknown) {
      console.error(`[FAIL] ${name}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  // 1. Fetch available products from DB to know what tags to test
  const products = await prisma.product.findMany();
  console.log(`Database Products: ${products.map(p => `${p.name} (Tag: ${p.rfidUid}, W: ${p.expectedWeight}g, P: ₹${p.price})`).join(", ")}\n`);

  if (products.length === 0) {
    console.error("No products found in DB. Run 'npm run db:seed' first.");
    process.exit(1);
  }

  const p1 = products[0]; // e.g. Amul Milk (520g, ₹28)
  const p2 = products[1] || products[0]; // e.g. Whole Wheat Bread (400g, ₹45)
  const testCart = "TEST_CART_99";

  // Step 1: Reset Cart Session
  await testStep("Reset / Create new cart session", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/reset`, { method: "POST" });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.status !== "RESET") throw new Error(`Unexpected status: ${JSON.stringify(data)}`);
  });

  // Step 2: Fetch Cart Info
  await testStep("GET Cart initial state", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.itemCount !== 0 || data.totalPrice !== 0) {
      throw new Error(`Cart not empty: ${JSON.stringify(data)}`);
    }
  });

  // Step 3: Valid Scan Item 1
  let currentCartWeight = p1.expectedWeight;
  await testStep(`Scan Valid Product 1 (${p1.name}) with matching weight (${currentCartWeight}g)`, async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfidUid: p1.rfidUid,
        measuredWeight: currentCartWeight,
      }),
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.status !== "SUCCESS" || data.alertBuzzer === true) {
      throw new Error(`Scan not successful: ${JSON.stringify(data)}`);
    }
  });

  // Step 4: Weight Mismatch Scan
  await testStep(`Scan Valid Product 2 with weight mismatch (scale tampering/theft check)`, async () => {
    // Add product 2 tag but do not add the correct weight (e.g. only 50g added instead of p2.expectedWeight)
    const badWeight = currentCartWeight + 20; // way outside tolerance
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfidUid: p2.rfidUid,
        measuredWeight: badWeight,
      }),
    });
    const data = await res.json();
    if (data.status !== "MISMATCH" || data.alertBuzzer !== true) {
      throw new Error(`Expected MISMATCH with buzzer alert, got: ${JSON.stringify(data)}`);
    }
  });

  // Step 5: Verify Cart is Flagged
  await testStep("Verify Cart is FLAGGED_MISMATCH after discrepancy", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}`);
    const data = await res.json();
    if (data.hasMismatch !== true || data.status !== "FLAGGED_MISMATCH") {
      throw new Error(`Cart should be flagged: ${JSON.stringify(data)}`);
    }
  });

  // Step 6: Unknown RFID Tag Test
  await testStep("Scan Unknown RFID Tag (should return 404 UNKNOWN_TAG)", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfidUid: "INVALID_UNKNOWN_TAG_999",
        measuredWeight: currentCartWeight,
      }),
    });
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    const data = await res.json();
    if (data.status !== "UNKNOWN_TAG") throw new Error(`Expected UNKNOWN_TAG: ${JSON.stringify(data)}`);
  });

  // Step 7: Valid Scan Product 2 (recovers mismatch)
  currentCartWeight += p2.expectedWeight;
  await testStep(`Scan Product 2 (${p2.name}) with correct weight (${currentCartWeight}g)`, async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rfidUid: p2.rfidUid,
        measuredWeight: currentCartWeight,
      }),
    });
    const data = await res.json();
    if (data.status !== "SUCCESS") throw new Error(`Scan failed: ${JSON.stringify(data)}`);
  });

  // Step 8: Remove-Last Item
  currentCartWeight -= p2.expectedWeight;
  await testStep(`Remove last item with scale balance check (${currentCartWeight}g)`, async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/remove-last`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measuredWeight: currentCartWeight,
      }),
    });
    const data = await res.json();
    if (data.status !== "SUCCESS") throw new Error(`Remove last failed: ${JSON.stringify(data)}`);
  });

  // Step 9: Pre-checkout Weight Verification & Bill Generation
  await testStep("Verify Cart Weight at Checkout (Generates Bill)", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measuredWeight: currentCartWeight,
      }),
    });
    const data = await res.json();
    if (data.status !== "BILL_GENERATED" || !data.billNumber || typeof data.finalTotal !== "number") {
      throw new Error(`Expected BILL_GENERATED with billNumber and total, got: ${JSON.stringify(data)}`);
    }
  });

  // Step 10: Complete Checkout with Payment
  await testStep("Checkout with UPI Payment (Completes Payment & Billing)", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/${testCart}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measuredWeight: currentCartWeight,
        paymentMethod: "UPI",
      }),
    });
    const data = await res.json();
    if (data.status !== "COMPLETED" || data.paymentMethod !== "UPI" || !data.reference) {
      throw new Error(`Checkout completion failed: ${JSON.stringify(data)}`);
    }
  });

  // Step 11: Admin Overview Check
  await testStep("Admin Overview reflects active and checked out carts", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/overview`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (typeof data.totalRevenue !== "number" || !Array.isArray(data.carts)) {
      throw new Error(`Invalid admin payload: ${JSON.stringify(data)}`);
    }
  });

  // Cleanup: Reset test cart
  await fetch(`${BASE_URL}/api/cart/${testCart}/reset`, { method: "POST" });

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log("==================================================");

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

runTest().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
