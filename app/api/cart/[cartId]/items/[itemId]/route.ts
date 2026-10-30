import { publishCartUpdate, removeCartItem } from "@/lib/cart";
import {
  readBody,
  readCartId,
  readEventId,
  readMeasuredWeight,
  withApi,
} from "@/lib/http";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ cartId: string; itemId: string }> },
) {
  return withApi(async () => {
    const { cartId, itemId } = await context.params;
    if (!itemId) {
      return Response.json(
        { status: "ERROR", message: "itemId is required" },
        { status: 400 },
      );
    }
    const body = await readBody(request);
    const result = await removeCartItem(
      readCartId(cartId),
      itemId,
      readMeasuredWeight(body),
      readEventId(body),
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
