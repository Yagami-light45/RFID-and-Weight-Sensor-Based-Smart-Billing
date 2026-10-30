import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { ADMIN_CHANNEL, cartChannel, publish } from "@/lib/realtime";
import type {
  CartPayload,
  OverviewPayload,
  PaymentMethod,
  ScanAction,
} from "@/lib/types";

const DEFAULT_TOLERANCE = 15;

const sessionInclude = {
  cart: true,
  items: {
    include: { product: true },
    orderBy: { createdAt: "asc" as const },
  },
  transaction: true,
} satisfies Prisma.ShoppingSessionInclude;

type SessionRecord = Prisma.ShoppingSessionGetPayload<{
  include: typeof sessionInclude;
}>;

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

export function toPayload(session: SessionRecord): CartPayload {
  const items = session.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    rfidUid: item.product.rfidUid,
    rfidTag: item.product.rfidUid,
    name: item.productNameSnapshot,
    unitPrice: Number(item.unitPriceSnapshot),
    expectedWeight: item.expectedWeightSnapshot,
    weightTolerance: item.product.weightTolerance,
    quantity: item.quantity,
    subtotal: Number(item.subtotal),
    lineWeight: roundGrams(item.expectedWeightSnapshot * item.quantity),
  }));

  const isCheckedOut = session.status === "COMPLETED";
  const status: CartPayload["status"] = isCheckedOut
    ? "CHECKED_OUT"
    : session.hasMismatch
      ? "FLAGGED_MISMATCH"
      : "ACTIVE";

  return {
    cartId: session.cartId,
    cartCode: session.cart.cartCode,
    operationalStatus: session.cart.operationalStatus,
    sessionId: session.id,
    sessionStatus: session.status,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    status,
    totalPrice: Number(session.totalPrice),
    totalExpectedWeight: session.totalExpectedWeight,
    currentMeasuredWeight: session.currentMeasuredWeight,
    hasMismatch: session.hasMismatch,
    updatedAt: session.updatedAt.toISOString(),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
    transaction: session.transaction
      ? {
          id: session.transaction.id,
          reference: session.transaction.reference,
          paymentMethod: session.transaction.paymentMethod,
          paymentStatus: session.transaction.paymentStatus,
          subtotal: Number(session.transaction.subtotal),
          tax: Number(session.transaction.tax),
          discount: Number(session.transaction.discount),
          finalTotal: Number(session.transaction.finalTotal),
          timestamp: session.transaction.timestamp.toISOString(),
        }
      : null,
  };
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** Ensure permanent trolley cart exists */
async function getOrCreateCart(tx: Tx, cartId: string) {
  const existing = await tx.cart.findUnique({ where: { cartId } });
  if (existing) return existing;
  try {
    return await tx.cart.create({
      data: {
        cartId,
        cartCode: cartId,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      return tx.cart.findUniqueOrThrow({ where: { cartId } });
    }
    throw error;
  }
}

/**
 * Enforce at most one ACTIVE shopping session per trolley through transactional logic.
 */
async function getOrCreateActiveSession(tx: Tx, cartId: string) {
  await getOrCreateCart(tx, cartId);
  await tx.$queryRaw`SELECT "cartId" FROM "Cart" WHERE "cartId" = ${cartId} FOR UPDATE`;

  // Look for current ACTIVE session
  const activeSession = await tx.shoppingSession.findFirst({
    where: { cartId, status: "ACTIVE" },
    include: sessionInclude,
  });
  if (activeSession) return activeSession;

  // Otherwise, create a new ACTIVE session
  return tx.shoppingSession.create({
    data: {
      cartId,
      status: "ACTIVE",
    },
    include: sessionInclude,
  });
}

/**
 * Get current session for cart (active session if open, or the latest completed session).
 */
async function getCurrentOrNewSession(tx: Tx, cartId: string) {
  await getOrCreateCart(tx, cartId);
  await tx.$queryRaw`SELECT "cartId" FROM "Cart" WHERE "cartId" = ${cartId} FOR UPDATE`;

  // First, look for an active session
  const activeSession = await tx.shoppingSession.findFirst({
    where: { cartId, status: "ACTIVE" },
    include: sessionInclude,
  });
  if (activeSession) return activeSession;

  // Next, look for the most recent session (e.g. recently checked out)
  const latestSession = await tx.shoppingSession.findFirst({
    where: { cartId },
    orderBy: { createdAt: "desc" },
    include: sessionInclude,
  });
  if (latestSession) return latestSession;

  // If none exists, create a new active session
  return tx.shoppingSession.create({
    data: {
      cartId,
      status: "ACTIVE",
    },
    include: sessionInclude,
  });
}

function assertOpenSession(session: { status: string }) {
  if (session.status === "COMPLETED") {
    throw new HttpError(409, "Cart is already checked out");
  }
  if (session.status === "ABANDONED") {
    throw new HttpError(409, "Shopping session is no longer active");
  }
}

async function recalculateSessionTotals(
  tx: Tx,
  sessionId: string,
  measuredWeight: number,
  mismatch: boolean,
) {
  const items = await tx.cartItem.findMany({
    where: { sessionId },
    include: { product: true },
  });

  const totalPrice = items.reduce(
    (sum, item) => sum + Number(item.subtotal),
    0,
  );
  const totalExpectedWeight = roundGrams(
    items.reduce(
      (sum, item) => sum + item.quantity * item.expectedWeightSnapshot,
      0,
    ),
  );

  return tx.shoppingSession.update({
    where: { id: sessionId },
    data: {
      totalPrice: new Prisma.Decimal(roundMoney(totalPrice)),
      totalExpectedWeight,
      currentMeasuredWeight: roundGrams(measuredWeight),
      hasMismatch: mismatch,
    },
    include: sessionInclude,
  });
}

async function recordScanEvent(
  tx: Tx,
  sessionId: string,
  rfidUid: string,
  action: ScanAction,
  measuredWeight: number,
  scanResult: "SUCCESS" | "MISMATCH" | "UNKNOWN_TAG" | "DUPLICATE",
  eventId?: string,
) {
  const effectiveEventId =
    eventId ||
    `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return tx.scanEvent.create({
    data: {
      eventId: effectiveEventId,
      sessionId,
      rfidUid,
      action,
      measuredWeight: roundGrams(measuredWeight),
      scanResult,
    },
  });
}

async function decrementSessionItem(
  tx: Tx,
  sessionId: string,
  productId: string,
  unitPrice: number,
) {
  const item = await tx.cartItem.findUnique({
    where: { sessionId_productId: { sessionId, productId } },
  });
  if (!item || item.quantity < 1) {
    throw new HttpError(400, "Item is not in the cart");
  }
  if (item.quantity === 1) {
    await tx.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const quantity = item.quantity - 1;
  const subtotal = roundMoney(quantity * unitPrice);
  await tx.cartItem.update({
    where: { id: item.id },
    data: {
      quantity,
      subtotal: new Prisma.Decimal(subtotal),
    },
  });
}

function result(
  status: number,
  body: Record<string, unknown>,
  session: SessionRecord,
): ActionResult {
  return { status, body, cart: toPayload(session) };
}

export async function getCart(cartId: string) {
  const session = await prisma.$transaction(async (tx) => {
    return getCurrentOrNewSession(tx, cartId);
  });
  return toPayload(session);
}

export async function scanItem(
  cartId: string,
  rfidUid: string,
  measuredWeight: number,
  eventId?: string,
) {
  return prisma.$transaction(async (tx) => {
    // Check idempotency if eventId is provided
    if (eventId) {
      const existingEvent = await tx.scanEvent.findUnique({
        where: { eventId },
      });
      if (existingEvent) {
        const session = await tx.shoppingSession.findUniqueOrThrow({
          where: { id: existingEvent.sessionId },
          include: sessionInclude,
        });
        return result(
          200,
          {
            status: "DUPLICATE",
            eventId,
            message: "Event already processed",
            total: Number(session.totalPrice),
          },
          session,
        );
      }
    }

    // Get current session or active session
    await getOrCreateCart(tx, cartId);
    await tx.$queryRaw`SELECT "cartId" FROM "Cart" WHERE "cartId" = ${cartId} FOR UPDATE`;

    const latestSession = await tx.shoppingSession.findFirst({
      where: { cartId },
      orderBy: { createdAt: "desc" },
      include: sessionInclude,
    });

    if (latestSession && latestSession.status === "COMPLETED") {
      throw new HttpError(409, "Cart is already checked out");
    }

    const session =
      latestSession ??
      (await tx.shoppingSession.create({
        data: {
          cartId,
          status: "ACTIVE",
        },
        include: sessionInclude,
      }));

    assertOpenSession(session);

    // Look up product by rfidUid
    const product = await tx.product.findUnique({ where: { rfidUid } });
    if (!product || !product.isAvailable) {
      const mismatch = exceedsTolerance(
        measuredWeight,
        session.totalExpectedWeight,
        DEFAULT_TOLERANCE,
      );
      await recordScanEvent(
        tx,
        session.id,
        rfidUid,
        "ADD",
        measuredWeight,
        "UNKNOWN_TAG",
        eventId,
      );
      const updated = await recalculateSessionTotals(
        tx,
        session.id,
        measuredWeight,
        mismatch,
      );
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
      session.totalExpectedWeight + product.expectedWeight,
    );
    if (exceedsTolerance(measuredWeight, nextExpected, product.weightTolerance)) {
      await recordScanEvent(
        tx,
        session.id,
        rfidUid,
        "ADD",
        measuredWeight,
        "MISMATCH",
        eventId,
      );
      const updated = await recalculateSessionTotals(
        tx,
        session.id,
        measuredWeight,
        true,
      );
      return result(200, { status: "MISMATCH", alertBuzzer: true }, updated);
    }

    // Within weight tolerance -> SUCCESS
    const existingItem = session.items.find(
      (item) => item.productId === product.id,
    );
    const unitPrice = Number(product.price);

    if (existingItem) {
      const quantity = existingItem.quantity + 1;
      const subtotal = roundMoney(quantity * unitPrice);
      await tx.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity,
          subtotal: new Prisma.Decimal(subtotal),
        },
      });
    } else {
      await tx.cartItem.create({
        data: {
          sessionId: session.id,
          productId: product.id,
          quantity: 1,
          productNameSnapshot: product.name,
          unitPriceSnapshot: product.price,
          subtotal: product.price,
          expectedWeightSnapshot: product.expectedWeight,
        },
      });
    }

    await recordScanEvent(
      tx,
      session.id,
      rfidUid,
      "ADD",
      measuredWeight,
      "SUCCESS",
      eventId,
    );
    const updated = await recalculateSessionTotals(
      tx,
      session.id,
      measuredWeight,
      false,
    );

    return result(
      200,
      {
        status: "SUCCESS",
        product: product.name,
        total: Number(updated.totalPrice),
      },
      updated,
    );
  });
}

export async function removeLastItem(
  cartId: string,
  measuredWeight: number,
  eventId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const session = await getOrCreateActiveSession(tx, cartId);
    assertOpenSession(session);

    // Find the latest successful ADD scan event in this session
    const logs = await tx.scanEvent.findMany({
      where: { sessionId: session.id, scanResult: "SUCCESS", action: "ADD" },
      orderBy: { timestamp: "desc" },
    });

    let targetItem: SessionRecord["items"][number] | null = null;
    for (const log of logs) {
      const product = await tx.product.findUnique({
        where: { rfidUid: log.rfidUid },
      });
      if (!product) continue;
      const item = session.items.find((entry) => entry.productId === product.id);
      if (item && item.quantity > 0) {
        targetItem = item;
        break;
      }
    }

    if (!targetItem) {
      throw new HttpError(400, "No scanned item to remove");
    }

    await decrementSessionItem(
      tx,
      session.id,
      targetItem.productId,
      Number(targetItem.unitPriceSnapshot),
    );

    const nextExpected = Math.max(
      0,
      roundGrams(session.totalExpectedWeight - targetItem.expectedWeightSnapshot),
    );
    const mismatch = exceedsTolerance(
      measuredWeight,
      nextExpected,
      targetItem.product.weightTolerance,
    );

    await recordScanEvent(
      tx,
      session.id,
      targetItem.product.rfidUid,
      "REMOVE",
      measuredWeight,
      mismatch ? "MISMATCH" : "SUCCESS",
      eventId,
    );

    const updated = await recalculateSessionTotals(
      tx,
      session.id,
      measuredWeight,
      mismatch,
    );

    return result(
      200,
      {
        status: mismatch ? "MISMATCH" : "SUCCESS",
        alertBuzzer: mismatch,
        product: targetItem.productNameSnapshot,
        total: Number(updated.totalPrice),
      },
      updated,
    );
  });
}

export async function removeCartItem(
  cartId: string,
  itemId: string,
  measuredWeight: number,
  eventId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const session = await getOrCreateActiveSession(tx, cartId);
    assertOpenSession(session);

    const item = session.items.find((entry) => entry.id === itemId);
    if (!item) throw new HttpError(404, "Item is not in the cart");

    await decrementSessionItem(
      tx,
      session.id,
      item.productId,
      Number(item.unitPriceSnapshot),
    );

    const nextExpected = Math.max(
      0,
      roundGrams(session.totalExpectedWeight - item.expectedWeightSnapshot),
    );
    const mismatch = exceedsTolerance(
      measuredWeight,
      nextExpected,
      item.product.weightTolerance,
    );

    await recordScanEvent(
      tx,
      session.id,
      item.product.rfidUid,
      "REMOVE",
      measuredWeight,
      mismatch ? "MISMATCH" : "SUCCESS",
      eventId,
    );

    const updated = await recalculateSessionTotals(
      tx,
      session.id,
      measuredWeight,
      mismatch,
    );

    return result(
      200,
      {
        status: mismatch ? "MISMATCH" : "SUCCESS",
        alertBuzzer: mismatch,
        product: item.productNameSnapshot,
        total: Number(updated.totalPrice),
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
    const session = await getOrCreateActiveSession(tx, cartId);
    assertOpenSession(session);
    if (session.items.length === 0) throw new HttpError(400, "Cart is empty");

    const tolerance = Math.max(
      ...session.items.map((item) => item.product.weightTolerance),
    );

    if (
      exceedsTolerance(measuredWeight, session.totalExpectedWeight, tolerance)
    ) {
      const updated = await recalculateSessionTotals(
        tx,
        session.id,
        measuredWeight,
        true,
      );
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
      const updated = await recalculateSessionTotals(
        tx,
        session.id,
        measuredWeight,
        false,
      );
      return result(
        200,
        {
          status: "VERIFIED",
          total: Number(updated.totalPrice),
          message: "Weight verified. Choose a payment method.",
        },
        updated,
      );
    }

    // Complete session and record Transaction
    const reference = `PAY-${cartId}-${Date.now().toString(36).toUpperCase()}`;

    await tx.transaction.create({
      data: {
        sessionId: session.id,
        subtotal: session.totalPrice,
        tax: new Prisma.Decimal(0),
        discount: new Prisma.Decimal(0),
        finalTotal: session.totalPrice,
        paymentMethod,
        paymentStatus: "PAID",
        reference,
      },
    });

    const updated = await tx.shoppingSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        currentMeasuredWeight: roundGrams(measuredWeight),
        hasMismatch: false,
      },
      include: sessionInclude,
    });

    return result(
      200,
      {
        status: "CHECKED_OUT",
        paymentMethod,
        reference,
        total: Number(updated.totalPrice),
        message: "Payment successful",
      },
      updated,
    );
  });
}

/**
 * Start a fresh shopping session for a subsequent customer.
 * Previous completed sessions, items, events, and transactions are NEVER deleted.
 */
export async function resetCart(cartId: string) {
  return prisma.$transaction(async (tx) => {
    await getOrCreateCart(tx, cartId);
    await tx.$queryRaw`SELECT "cartId" FROM "Cart" WHERE "cartId" = ${cartId} FOR UPDATE`;

    // Mark any existing active sessions as ABANDONED (or COMPLETED if already checked out)
    const existingActive = await tx.shoppingSession.findMany({
      where: { cartId, status: "ACTIVE" },
    });

    for (const active of existingActive) {
      await tx.shoppingSession.update({
        where: { id: active.id },
        data: {
          status: "ABANDONED",
          completedAt: new Date(),
        },
      });
    }

    // Create a new, fresh ACTIVE session for this trolley
    const newSession = await tx.shoppingSession.create({
      data: {
        cartId,
        status: "ACTIVE",
      },
      include: sessionInclude,
    });

    return result(200, { status: "RESET", cartId }, newSession);
  });
}

export async function getOverview(): Promise<OverviewPayload> {
  const carts = await prisma.cart.findMany({
    orderBy: { cartId: "asc" },
  });

  const cartPayloads: CartPayload[] = [];
  for (const cart of carts) {
    const session = await prisma.shoppingSession.findFirst({
      where: { cartId: cart.cartId },
      orderBy: { createdAt: "desc" },
      include: sessionInclude,
    });
    if (session) {
      cartPayloads.push(toPayload(session));
    } else {
      cartPayloads.push({
        cartId: cart.cartId,
        cartCode: cart.cartCode,
        operationalStatus: cart.operationalStatus,
        status: "ACTIVE",
        totalPrice: 0,
        totalExpectedWeight: 0,
        currentMeasuredWeight: 0,
        hasMismatch: false,
        updatedAt: cart.updatedAt.toISOString(),
        itemCount: 0,
        items: [],
      });
    }
  }

  // Calculate total revenue from all completed transactions
  const transactions = await prisma.transaction.findMany({
    where: { paymentStatus: "PAID" },
  });
  const totalRevenue = roundMoney(
    transactions.reduce((sum, tx) => sum + Number(tx.finalTotal), 0),
  );

  const activeSessionsCount = await prisma.shoppingSession.count({
    where: { status: "ACTIVE" },
  });

  const flaggedCartsCount = cartPayloads.filter(
    (c) => c.hasMismatch || c.status === "FLAGGED_MISMATCH",
  ).length;

  return {
    totalRevenue,
    activeSessions: activeSessionsCount,
    flaggedCarts: flaggedCartsCount,
    carts: cartPayloads,
  };
}

export async function publishCartUpdate(cart: CartPayload) {
  publish(cartChannel(cart.cartId), "cart", cart);
  publish(ADMIN_CHANNEL, "overview", await getOverview());
}
