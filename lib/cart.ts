import { Prisma, type ScanStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { ADMIN_CHANNEL, cartChannel, publish } from "@/lib/realtime";
import type { CartPayload, OverviewPayload, PaymentMethod } from "@/lib/types";

const DEFAULT_TOLERANCE = 15;

const cartInclude = {
  items: {
    include: { product: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.CartInclude;

type CartRecord = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type Tx = Prisma.TransactionClient;

export type ActionResult = {
  status: number;
  body: Record<string, unknown>;
  cart: CartPayload;
};

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundGrams(value: number) {
  return Math.round(value * 10) / 10;
}

/** True when the scale disagrees by more than the allowed grams. */
export function exceedsTolerance(
  measured: number,
  expected: number,
  tolerance: number,
) {
  return Math.abs(measured - expected) - tolerance > 1e-6;
}

export function toPayload(cart: CartRecord): CartPayload {
  const items = cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    rfidTag: item.product.rfidTag,
    name: item.product.name,
    unitPrice: item.product.price,
    expectedWeight: item.product.expectedWeight,
    weightTolerance: item.product.weightTolerance,
    quantity: item.quantity,
    subtotal: item.subtotal,
    lineWeight: roundGrams(item.product.expectedWeight * item.quantity),
  }));

  return {
    cartId: cart.cartId,
    status: cart.status,
    totalPrice: cart.totalPrice,
    totalExpectedWeight: cart.totalExpectedWeight,
    currentMeasuredWeight: cart.currentMeasuredWeight,
    hasMismatch: cart.hasMismatch,
    updatedAt: cart.updatedAt.toISOString(),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function getOrCreateCart(tx: Tx, cartId: string) {
  const existing = await tx.cart.findUnique({ where: { cartId } });
  if (existing) return existing;
  try {
    return await tx.cart.create({ data: { cartId } });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return tx.cart.findUniqueOrThrow({ where: { cartId } });
    }
    throw error;
  }
}

async function lockCart(tx: Tx, cartId: string) {
  await tx.$queryRaw`SELECT "cartId" FROM "Cart" WHERE "cartId" = ${cartId} FOR UPDATE`;
  return tx.cart.findUniqueOrThrow({
    where: { cartId },
    include: cartInclude,
  });
}

function assertOpen(cart: { status: string }) {
  if (cart.status === "CHECKED_OUT") {
    throw new HttpError(409, "Cart is already checked out");
  }
}

async function writeOpenCart(
  tx: Tx,
  cartId: string,
  measuredWeight: number,
  mismatch: boolean,
) {
  const items = await tx.cartItem.findMany({
    where: { cartId },
    include: { product: true },
  });
  const totalPrice = roundMoney(
    items.reduce((sum, item) => sum + item.quantity * item.product.price, 0),
  );
  const totalExpectedWeight = roundGrams(
    items.reduce(
      (sum, item) => sum + item.quantity * item.product.expectedWeight,
      0,
    ),
  );

  return tx.cart.update({
    where: { cartId },
    data: {
      totalPrice,
      totalExpectedWeight,
      currentMeasuredWeight: roundGrams(measuredWeight),
      hasMismatch: mismatch,
      status: mismatch ? "FLAGGED_MISMATCH" : "ACTIVE",
    },
    include: cartInclude,
  });
}

async function logScan(
  tx: Tx,
  cartId: string,
  rfidTag: string,
  measuredWeight: number,
  status: ScanStatus,
) {
  await tx.scanLog.create({
    data: {
      cartId,
      rfidTag,
      measuredWeight: roundGrams(measuredWeight),
      status,
    },
  });
}

async function decrementItem(
  tx: Tx,
  cartId: string,
  productId: string,
  price: number,
) {
  const item = await tx.cartItem.findUnique({
    where: { cartId_productId: { cartId, productId } },
  });
  if (!item || item.quantity < 1) {
    throw new HttpError(400, "Item is not in the cart");
  }
  if (item.quantity === 1) {
    await tx.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const quantity = item.quantity - 1;
  await tx.cartItem.update({
    where: { id: item.id },
    data: { quantity, subtotal: roundMoney(quantity * price) },
  });
}

function result(
  status: number,
  body: Record<string, unknown>,
  cart: CartRecord,
): ActionResult {
  return { status, body, cart: toPayload(cart) };
}

export async function getCart(cartId: string) {
  const cart = await prisma.$transaction(async (tx) => {
    await getOrCreateCart(tx, cartId);
    return lockCart(tx, cartId);
  });
  return toPayload(cart);
}

export async function scanItem(
  cartId: string,
  rfidTag: string,
  measuredWeight: number,
) {
  return prisma.$transaction(async (tx) => {
    await getOrCreateCart(tx, cartId);
    const cart = await lockCart(tx, cartId);
    assertOpen(cart);

    const product = await tx.product.findUnique({ where: { rfidTag } });
    if (!product) {
      const mismatch = exceedsTolerance(
        measuredWeight,
        cart.totalExpectedWeight,
        DEFAULT_TOLERANCE,
      );
      await logScan(tx, cartId, rfidTag, measuredWeight, "UNKNOWN_TAG");
      const updated = await writeOpenCart(tx, cartId, measuredWeight, mismatch);
      return result(
        404,
        {
          status: "UNKNOWN_TAG",
          alertBuzzer: mismatch,
          message: "No product is registered for this RFID tag",
        },
        updated,
      );
    }

    const nextExpected = roundGrams(
      cart.totalExpectedWeight + product.expectedWeight,
    );
    if (exceedsTolerance(measuredWeight, nextExpected, product.weightTolerance)) {
      await logScan(tx, cartId, rfidTag, measuredWeight, "WEIGHT_MISMATCH");
      const updated = await writeOpenCart(tx, cartId, measuredWeight, true);
      return result(200, { status: "MISMATCH", alertBuzzer: true }, updated);
    }

    const existing = cart.items.find((item) => item.productId === product.id);
    if (existing) {
      const quantity = existing.quantity + 1;
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity, subtotal: roundMoney(quantity * product.price) },
      });
    } else {
      await tx.cartItem.create({
        data: {
          cartId,
          productId: product.id,
          quantity: 1,
          subtotal: roundMoney(product.price),
        },
      });
    }

    await logScan(tx, cartId, rfidTag, measuredWeight, "SUCCESS");
    const updated = await writeOpenCart(tx, cartId, measuredWeight, false);
    return result(
      200,
      { status: "SUCCESS", product: product.name, total: updated.totalPrice },
      updated,
    );
  });
}

export async function removeLastItem(cartId: string, measuredWeight: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cart.findUnique({ where: { cartId } });
    if (!existing) throw new HttpError(404, "Cart not found");

    const cart = await lockCart(tx, cartId);
    assertOpen(cart);

    const logs = await tx.scanLog.findMany({
      where: { cartId, status: "SUCCESS" },
      orderBy: { timestamp: "desc" },
    });

    let product: CartRecord["items"][number]["product"] | null = null;
    for (const log of logs) {
      const found = await tx.product.findUnique({ where: { rfidTag: log.rfidTag } });
      if (!found) continue;
      const item = cart.items.find((entry) => entry.productId === found.id);
      if (item && item.quantity > 0) {
        product = found;
        break;
      }
    }
    if (!product) throw new HttpError(400, "No scanned item to remove");

    await decrementItem(tx, cartId, product.id, product.price);
    const nextExpected = Math.max(
      0,
      roundGrams(cart.totalExpectedWeight - product.expectedWeight),
    );
    const mismatch = exceedsTolerance(
      measuredWeight,
      nextExpected,
      product.weightTolerance,
    );
    await logScan(tx, cartId, product.rfidTag, measuredWeight, "ITEM_REMOVED");
    const updated = await writeOpenCart(tx, cartId, measuredWeight, mismatch);

    return result(
      200,
      {
        status: mismatch ? "MISMATCH" : "SUCCESS",
        alertBuzzer: mismatch,
        product: product.name,
        total: updated.totalPrice,
      },
      updated,
    );
  });
}

export async function removeCartItem(
  cartId: string,
  itemId: string,
  measuredWeight: number,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cart.findUnique({ where: { cartId } });
    if (!existing) throw new HttpError(404, "Cart not found");

    const cart = await lockCart(tx, cartId);
    assertOpen(cart);
    const item = cart.items.find((entry) => entry.id === itemId);
    if (!item) throw new HttpError(404, "Item is not in the cart");

    await decrementItem(tx, cartId, item.productId, item.product.price);
    const nextExpected = Math.max(
      0,
      roundGrams(cart.totalExpectedWeight - item.product.expectedWeight),
    );
    const mismatch = exceedsTolerance(
      measuredWeight,
      nextExpected,
      item.product.weightTolerance,
    );
    await logScan(
      tx,
      cartId,
      item.product.rfidTag,
      measuredWeight,
      "ITEM_REMOVED",
    );
    const updated = await writeOpenCart(tx, cartId, measuredWeight, mismatch);

    return result(
      200,
      {
        status: mismatch ? "MISMATCH" : "SUCCESS",
        alertBuzzer: mismatch,
        product: item.product.name,
        total: updated.totalPrice,
      },
      updated,
    );
  });
}

export async function checkoutCart(
  cartId: string,
  measuredWeight: number,
  paymentMethod?: PaymentMethod,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cart.findUnique({ where: { cartId } });
    if (!existing) throw new HttpError(404, "Cart not found");

    const cart = await lockCart(tx, cartId);
    assertOpen(cart);
    if (cart.items.length === 0) throw new HttpError(400, "Cart is empty");

    const tolerance = Math.max(
      ...cart.items.map((item) => item.product.weightTolerance),
    );
    if (exceedsTolerance(measuredWeight, cart.totalExpectedWeight, tolerance)) {
      const updated = await writeOpenCart(tx, cartId, measuredWeight, true);
      return result(
        200,
        {
          status: "FLAGGED",
          alertBuzzer: true,
          message: "Weight mismatch. Cart flagged for cashier audit.",
        },
        updated,
      );
    }

    if (!paymentMethod) {
      const updated = await writeOpenCart(tx, cartId, measuredWeight, false);
      return result(
        200,
        {
          status: "VERIFIED",
          total: updated.totalPrice,
          message: "Weight verified. Choose a payment method.",
        },
        updated,
      );
    }

    const updated = await tx.cart.update({
      where: { cartId },
      data: {
        currentMeasuredWeight: roundGrams(measuredWeight),
        hasMismatch: false,
        status: "CHECKED_OUT",
      },
      include: cartInclude,
    });
    const reference = `PAY-${cartId}-${Date.now().toString(36).toUpperCase()}`;

    return result(
      200,
      {
        status: "CHECKED_OUT",
        paymentMethod,
        reference,
        total: updated.totalPrice,
        message: "Payment successful",
      },
      updated,
    );
  });
}

export async function resetCart(cartId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cart.findUnique({ where: { cartId } });
    if (!existing) throw new HttpError(404, "Cart not found");
    await lockCart(tx, cartId);
    await tx.cartItem.deleteMany({ where: { cartId } });
    const updated = await tx.cart.update({
      where: { cartId },
      data: {
        status: "ACTIVE",
        totalPrice: 0,
        totalExpectedWeight: 0,
        currentMeasuredWeight: 0,
        hasMismatch: false,
      },
      include: cartInclude,
    });
    return result(200, { status: "RESET", cartId }, updated);
  });
}

export async function getOverview(): Promise<OverviewPayload> {
  const carts = await prisma.cart.findMany({
    include: cartInclude,
    orderBy: { cartId: "asc" },
  });
  const payloads = carts.map(toPayload);
  return {
    totalRevenue: roundMoney(
      payloads
        .filter((cart) => cart.status === "CHECKED_OUT")
        .reduce((sum, cart) => sum + cart.totalPrice, 0),
    ),
    activeSessions: payloads.filter((cart) => cart.status !== "CHECKED_OUT")
      .length,
    flaggedCarts: payloads.filter(
      (cart) => cart.hasMismatch || cart.status === "FLAGGED_MISMATCH",
    ).length,
    carts: payloads,
  };
}

export async function publishCartUpdate(cart: CartPayload) {
  publish(cartChannel(cart.cartId), "cart", cart);
  publish(ADMIN_CHANNEL, "overview", await getOverview());
}
