import { generateFinalBill, publishCartUpdate } from "@/lib/cart";
import {
  readBody,
  readCartId,
  readMeasuredWeight,
  withApi,
} from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    let measuredWeight: number | undefined;
    try {
      const body = await readBody(request);
      measuredWeight = readMeasuredWeight(body);
    } catch {
      // If no body or measuredWeight not supplied, generateFinalBill uses recorded weight
    }
    const result = await generateFinalBill(readCartId(cartId), measuredWeight);
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
