import { checkoutCart, publishCartUpdate } from "@/lib/cart";
import {
  readBody,
  readCartId,
  readMeasuredWeight,
  readPaymentMethod,
  withApi,
} from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const body = await readBody(request);
    const result = await checkoutCart(
      readCartId(cartId),
      readMeasuredWeight(body),
      readPaymentMethod(body),
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
