import { confirmCashierPayment, publishCartUpdate } from "@/lib/cart";
import {
  readBody,
  readCartId,
  readPaymentMethod,
  withApi,
  HttpError,
} from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
) {
  return withApi(async () => {
    const { cartId } = await context.params;
    const body = await readBody(request);
    const paymentMethod = readPaymentMethod(body);
    if (!paymentMethod) {
      throw new HttpError(
        400,
        "Valid paymentMethod (CASH, CARD, or UPI) is required for cashier confirmation",
      );
    }
    const reference =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).reference === "string"
        ? ((body as Record<string, unknown>).reference as string).trim() ||
          undefined
        : undefined;

    const result = await confirmCashierPayment(
      readCartId(cartId),
      paymentMethod,
      reference,
    );
    await publishCartUpdate(result.cart);
    return Response.json(result.body, { status: result.status });
  });
}
