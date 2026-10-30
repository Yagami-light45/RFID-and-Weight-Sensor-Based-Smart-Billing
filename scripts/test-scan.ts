import { prisma } from "../lib/prisma";
import { scanItem } from "../lib/cart";

async function testScan() {
  console.log("Starting test scan...");
  try {
    const res = await scanItem("CART_01", "E2MILK001", 520);
    console.log("Scan success:", res.body);
  } catch (err) {
    console.error("Scan failed with error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

testScan();
