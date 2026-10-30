import { publishCartUpdate, scanItem } from "@/lib/cart";
import { readBody, readCartId, readMeasuredWeight, readRfidTag, withApi } from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const body = await readBody(request);
    const result = await scanItem(
      readCartId(cartId),
      readRfidTag(body),
      readMeasuredWeight(body),
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
