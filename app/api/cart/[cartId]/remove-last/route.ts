import { publishCartUpdate, removeLastItem } from "@/lib/cart";
import {
  readBody,
  readCartId,
  readEventId,
  readMeasuredWeight,
  withApi,
} from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const body = await readBody(request);
    const result = await removeLastItem(
      readCartId(cartId),
      readMeasuredWeight(body),
      readEventId(body),
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
