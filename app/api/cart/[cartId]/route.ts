import { getCart } from "@/lib/cart";
import { readCartId, withApi } from "@/lib/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const cart = await getCart(readCartId(cartId));
    return Response.json(cart);
  });
}
