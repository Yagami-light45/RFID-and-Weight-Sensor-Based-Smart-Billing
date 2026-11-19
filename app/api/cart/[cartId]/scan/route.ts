import { publishCartUpdate, scanItem } from "@/lib/cart";
import {
  readBody,
  readCartId,
  readEventId,
  readMeasuredWeight,
  readRfidUid,
  withApi,
} from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    // [TROLLEY LIVE LOGS] RFID HTTP input, database outcome and website publication.
    const started = Date.now();
    const { cartId: rawCartId } = await context.params;
    const cartId = readCartId(rawCartId);
    const body = await readBody(request);
    const uid = readRfidUid(body);
    const grams = readMeasuredWeight(body);
    const eventId = readEventId(body);

    console.log("\n[RFID POST IN]", {
      time: new Date().toISOString(), cartId,
      rfidUid: uid, measuredWeightGrams: grams, eventId: eventId ?? null,
    });
    try {
      const result = await scanItem(cartId, uid, grams, eventId);
      console.log("[DATABASE RESULT]", {
        http: result.status,
        scanStatus: result.body.status,
        product: result.body.product ?? null,
        cartId: result.cart.cartId,
        cartStatus: result.cart.status,
        itemCount: result.cart.itemCount,
        totalPriceINR: result.cart.totalPrice,
        expectedWeightGrams: result.cart.totalExpectedWeight,
        measuredWeightGrams: result.cart.currentMeasuredWeight,
        hasMismatch: result.cart.hasMismatch,
        cartUpdatedAt: result.cart.updatedAt,
        durationMs: Date.now() - started,
      });
      console.log("[CART ITEMS]", result.cart.items.map(item => ({
        name: item.name, uid: item.rfidUid,
        quantity: item.quantity, subtotalINR: item.subtotal,
      })));
      await publishCartUpdate(result.cart);
      console.log("[RFID POST DONE]", {
        http: result.status, status: result.body.status,
        durationMs: Date.now() - started,
      });
      return Response.json(result.body, { status: result.status });
    } catch (error) {
      console.error("[RFID POST ERROR]", {
        cartId, rfidUid: uid, message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      throw error;
    }
  });
}
