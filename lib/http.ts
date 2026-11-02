import { unstable_rethrow } from "next/navigation";
import { isCartId } from "@/lib/ids";
import type { PaymentMethod, ScanAction } from "@/lib/types";

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

export function readRfidUid(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "rfidUid or rfidTag is required");
  }
  const b = body as Record<string, unknown>;
  const value = b.rfidUid ?? b.rfidTag;
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "rfidUid or rfidTag must be a non-empty string");
  }
  return value.trim();
}

/** Backward compatibility alias for readRfidUid */
export const readRfidTag = readRfidUid;

export function readEventId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>).eventId;
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return undefined;
}

export function readAction(body: unknown): ScanAction {
  if (!body || typeof body !== "object") return "ADD";
  const value = (body as Record<string, unknown>).action;
  if (value === "REMOVE") return "REMOVE";
  return "ADD";
}

export function readPaymentMethod(body: unknown): PaymentMethod | undefined {
  if (!body || typeof body !== "object" || !("paymentMethod" in body)) {
    return undefined;
  }
  const value = (body as { paymentMethod: unknown }).paymentMethod;
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "CASH" || value === "CARD" || value === "UPI") return value;
  throw new HttpError(400, "paymentMethod must be CASH, CARD, or UPI");
}
