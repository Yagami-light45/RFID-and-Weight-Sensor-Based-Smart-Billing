import { unstable_rethrow } from "next/navigation";
import { isCartId } from "@/lib/ids";
import type { PaymentMethod } from "@/lib/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function withApi(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof HttpError) {
      return Response.json(
        { status: "ERROR", message: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return Response.json(
      { status: "ERROR", message: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

export function readCartId(cartId: string) {
  if (!isCartId(cartId)) {
    throw new HttpError(
      400,
      "cartId must be 1-32 letters, numbers, underscores, or hyphens",
    );
  }
  return cartId;
}

export function readMeasuredWeight(body: unknown) {
  if (!body || typeof body !== "object" || !("measuredWeight" in body)) {
    throw new HttpError(400, "measuredWeight is required");
  }
  const value = (body as { measuredWeight: unknown }).measuredWeight;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, "measuredWeight must be a non-negative number");
  }
  return value;
}

export function readRfidTag(body: unknown) {
  if (!body || typeof body !== "object" || !("rfidTag" in body)) {
    throw new HttpError(400, "rfidTag is required");
  }
  const value = (body as { rfidTag: unknown }).rfidTag;
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "rfidTag must be a non-empty string");
  }
  return value.trim();
}

export function readPaymentMethod(body: unknown): PaymentMethod | undefined {
  if (!body || typeof body !== "object" || !("paymentMethod" in body)) {
    return undefined;
  }
  const value = (body as { paymentMethod: unknown }).paymentMethod;
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "UPI" || value === "CARD") return value;
  throw new HttpError(400, "paymentMethod must be UPI or CARD");
}
