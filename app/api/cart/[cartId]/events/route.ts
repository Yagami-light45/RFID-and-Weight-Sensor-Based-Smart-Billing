import { getCart } from "@/lib/cart";
import { readCartId, withApi } from "@/lib/http";
import { cartChannel } from "@/lib/realtime";
import { eventStream } from "@/lib/sse";

export async function GET(
  _request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const id = readCartId(cartId);
    const cart = await getCart(id);
    return eventStream(cartChannel(id), [{ event: "cart", data: cart }]);
  });
}
