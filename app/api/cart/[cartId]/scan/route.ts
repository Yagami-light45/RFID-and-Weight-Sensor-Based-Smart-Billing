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
    const { cartId } = await context.params;
    const body = await readBody(request);
    const result = await scanItem(
      readCartId(cartId),
      readRfidUid(body),
      readMeasuredWeight(body),
      readEventId(body),
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
