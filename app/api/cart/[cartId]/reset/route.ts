import { publishCartUpdate, resetCart } from "@/lib/cart";
import { readCartId, withApi } from "@/lib/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const result = await resetCart(readCartId(cartId));
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
