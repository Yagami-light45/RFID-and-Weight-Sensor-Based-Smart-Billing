import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { ADMIN_CHANNEL, cartChannel, publish } from "@/lib/realtime";
import type {
  BillHistoryItem,
  BillStatus,
  CartPayload,
  OverviewPayload,
  PaymentMethod,
  PaymentStatus,
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
  const isPaymentPending =
    session.status === "PAYMENT_PENDING" || session.status === "BILL_GENERATED";

  const status: CartPayload["status"] = isCheckedOut
    ? "CHECKED_OUT"
    : isPaymentPending
      ? "PAYMENT_PENDING"
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
          billNumber:
            session.transaction.billNumber ||
            session.transaction.reference ||
            `BILL-${session.cartId}-${session.transaction.id.slice(-6).toUpperCase()}`,
          reference: session.transaction.reference,
          paymentMethod: (session.transaction.paymentMethod as PaymentMethod) || null,
          paymentStatus: (session.transaction.paymentStatus as PaymentStatus) || "PENDING",
          billStatus: (session.transaction.billStatus as BillStatus) || "PENDING",
          subtotal: Number(session.transaction.subtotal),
          tax: Number(session.transaction.tax),
          discount: Number(session.transaction.discount),
          finalTotal: Number(session.transaction.finalTotal),
          cashierConfirmedAt: session.transaction.cashierConfirmedAt
            ? session.transaction.cashierConfirmedAt.toISOString()
            : null,
          createdAt: session.transaction.createdAt
            ? session.transaction.createdAt.toISOString()
            : session.transaction.timestamp.toISOString(),
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

const TX_CONFIG = {
  maxWait: 15000,
  timeout: 35000,
};

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
 * Enforce at most one ACTIVE / open shopping session per trolley through transactional logic.
 */
async function getOrCreateActiveSession(tx: Tx, cartId: string) {
  await getOrCreateCart(tx, cartId);

  // Look for current open session (ACTIVE or PAYMENT_PENDING/BILL_GENERATED)
  const openSession = await tx.shoppingSession.findFirst({
    where: {
      cartId,
      status: { in: ["ACTIVE", "PAYMENT_PENDING", "BILL_GENERATED"] },
    },
    include: sessionInclude,
  });
  if (openSession) return openSession;

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

  // First, look for an open session
  const openSession = await tx.shoppingSession.findFirst({
    where: {
      cartId,
      status: { in: ["ACTIVE", "PAYMENT_PENDING", "BILL_GENERATED"] },
    },
    include: sessionInclude,
  });
  if (openSession) return openSession;

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
      // If customer was in PAYMENT_PENDING and scans more items, move back to ACTIVE
      status: mismatch ? "ACTIVE" : undefined,
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

// In-memory cache for ultra-fast page navigation & deduplicating simultaneous requests
let cachedOverview: { data: OverviewPayload; timestamp: number } | null = null;
const cartCache = new Map<string, { data: CartPayload; timestamp: number }>();
const CACHE_TTL_MS = 3000; // 3 seconds TTL

export function invalidateCache(cartId?: string) {
  cachedOverview = null;
  if (cartId) {
    cartCache.delete(cartId);
  } else {
    cartCache.clear();
  }
}

export async function getCart(cartId: string) {
  const cached = cartCache.get(cartId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Fast direct read without interactive transaction overhead
  let session = await prisma.shoppingSession.findFirst({
    where: {
      cartId,
      status: { in: ["ACTIVE", "PAYMENT_PENDING", "BILL_GENERATED"] },
    },
    include: sessionInclude,
  });

  if (!session) {
    session = await prisma.shoppingSession.findFirst({
      where: { cartId },
      orderBy: { createdAt: "desc" },
      include: sessionInclude,
    });
  }

  // If still no session, create one safely
  if (!session) {
    session = await prisma.$transaction(async (tx) => {
      return getCurrentOrNewSession(tx, cartId);
    }, TX_CONFIG);
  }

  const payload = toPayload(session);
  cartCache.set(cartId, { data: payload, timestamp: Date.now() });
  return payload;
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
    const mismatch = exceedsTolerance(
      measuredWeight,
      nextExpected,
      product.weightTolerance,
    );

    // Registered RFID products are added regardless of weight mismatch.
    // The mismatch still flags the cart for the website to display.
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
        product: product.name,
        total: Number(updated.totalPrice),
      },
      updated,
    );
  }, TX_CONFIG);
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
  }, TX_CONFIG);
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
  }, TX_CONFIG);
}

/**
 * Generate Final Bill for the Customer.
 * Verifies load cell weight, calculates tax/discounts, creates pending bill record.
 * DOES NOT mark session as completed or paid.
 */
export async function generateFinalBill(cartId: string, measuredWeight?: number) {
  return prisma.$transaction(async (tx) => {
    const session = await getOrCreateActiveSession(tx, cartId);
    assertOpenSession(session);
    if (session.items.length === 0) {
      throw new HttpError(400, "Cannot generate bill for an empty cart");
    }

    const actualWeight =
      typeof measuredWeight === "number" && Number.isFinite(measuredWeight)
        ? measuredWeight
        : session.currentMeasuredWeight;

    const tolerance = Math.max(
      ...session.items.map((item) => item.product.weightTolerance),
    );

    if (
      exceedsTolerance(actualWeight, session.totalExpectedWeight, tolerance)
    ) {
      const updated = await recalculateSessionTotals(
        tx,
        session.id,
        actualWeight,
        true,
      );
      return result(
        200,
        {
          status: "FLAGGED",
          alertBuzzer: true,
          message: "Weight mismatch. Please verify items before generating bill.",
        },
        updated,
      );
    }

    // Calculations
    const subtotal = roundMoney(Number(session.totalPrice));
    const tax = roundMoney(subtotal * 0.05); // Standard 5% GST
    const discount = 0;
    const finalTotal = roundMoney(subtotal + tax - discount);

    // Look for existing transaction or create new one
    let txRecord = await tx.transaction.findUnique({
      where: { sessionId: session.id },
    });

    if (!txRecord) {
      const billNumber = `BILL-${cartId}-${Date.now().toString(36).toUpperCase()}`;
      txRecord = await tx.transaction.create({
        data: {
          sessionId: session.id,
          billNumber,
          subtotal: new Prisma.Decimal(subtotal),
          tax: new Prisma.Decimal(tax),
          discount: new Prisma.Decimal(discount),
          finalTotal: new Prisma.Decimal(finalTotal),
          billStatus: "PENDING",
          paymentStatus: "PENDING",
          paymentMethod: null,
          reference: billNumber,
        },
      });
    } else if (txRecord.paymentStatus !== "PAID") {
      txRecord = await tx.transaction.update({
        where: { id: txRecord.id },
        data: {
          subtotal: new Prisma.Decimal(subtotal),
          tax: new Prisma.Decimal(tax),
          discount: new Prisma.Decimal(discount),
          finalTotal: new Prisma.Decimal(finalTotal),
        },
      });
    }

    const updated = await tx.shoppingSession.update({
      where: { id: session.id },
      data: {
        status: "PAYMENT_PENDING",
        currentMeasuredWeight: roundGrams(actualWeight),
        hasMismatch: false,
      },
      include: sessionInclude,
    });

    return result(
      200,
      {
        status: "BILL_GENERATED",
        billNumber: txRecord.billNumber,
        subtotal,
        tax,
        discount,
        finalTotal,
        message:
          "Bill generated successfully. Please proceed to the billing counter to complete your payment.",
      },
      updated,
    );
  }, TX_CONFIG);
}

/**
 * Cashier Physical Counter Payment Confirmation.
 * Called ONLY by the cashier at the physical counter after receiving Cash, POS Card, or UPI payment.
 */
export async function confirmCashierPayment(
  cartId: string,
  paymentMethod: PaymentMethod,
  reference?: string,
) {
  return prisma.$transaction(async (tx) => {
    // Find open session
    const session = await tx.shoppingSession.findFirst({
      where: {
        cartId,
        status: { in: ["PAYMENT_PENDING", "BILL_GENERATED", "ACTIVE"] },
      },
      orderBy: { createdAt: "desc" },
      include: sessionInclude,
    });

    if (!session) {
      throw new HttpError(404, "No active session or bill found for this trolley");
    }

    if (session.items.length === 0) {
      throw new HttpError(400, "Cannot complete checkout for an empty cart");
    }

    const subtotal = roundMoney(Number(session.totalPrice));
    const tax = roundMoney(subtotal * 0.05);
    const discount = 0;
    const finalTotal = roundMoney(subtotal + tax - discount);
    const finalReference =
      reference || `PAY-${paymentMethod}-${cartId}-${Date.now().toString(36).toUpperCase()}`;

    // Update or create Transaction
    let txRecord = await tx.transaction.findUnique({
      where: { sessionId: session.id },
    });

    if (txRecord) {
      if (txRecord.paymentStatus === "PAID") {
        throw new HttpError(409, "This bill has already been paid and completed");
      }
      txRecord = await tx.transaction.update({
        where: { id: txRecord.id },
        data: {
          paymentMethod,
          paymentStatus: "PAID",
          billStatus: "PAID",
          cashierConfirmedAt: new Date(),
          reference: finalReference,
          finalTotal: new Prisma.Decimal(finalTotal),
        },
      });
    } else {
      const billNumber = `BILL-${cartId}-${Date.now().toString(36).toUpperCase()}`;
      txRecord = await tx.transaction.create({
        data: {
          sessionId: session.id,
          billNumber,
          subtotal: new Prisma.Decimal(subtotal),
          tax: new Prisma.Decimal(tax),
          discount: new Prisma.Decimal(discount),
          finalTotal: new Prisma.Decimal(finalTotal),
          paymentMethod,
          paymentStatus: "PAID",
          billStatus: "PAID",
          cashierConfirmedAt: new Date(),
          reference: finalReference,
        },
      });
    }

    // Complete session
    const updated = await tx.shoppingSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        hasMismatch: false,
      },
      include: sessionInclude,
    });

    return result(
      200,
      {
        status: "COMPLETED",
        billNumber: txRecord.billNumber,
        paymentMethod,
        reference: txRecord.reference,
        total: Number(txRecord.finalTotal),
        cashierConfirmedAt: txRecord.cashierConfirmedAt?.toISOString(),
        message: `Payment confirmed via ${paymentMethod} by cashier. Billing completed.`,
      },
      updated,
    );
  }, TX_CONFIG);
}

/**
 * Checkout / Bill Verification compatibility endpoint.
 */
export async function checkoutCart(
  cartId: string,
  measuredWeight: number,
  paymentMethod?: PaymentMethod,
) {
  // If payment method is provided directly (e.g. from automated simulation), complete payment
  if (paymentMethod) {
    return confirmCashierPayment(cartId, paymentMethod);
  }

  // Otherwise, generate the final bill for counter payment
  return generateFinalBill(cartId, measuredWeight);
}

/**
 * Start a fresh shopping session for a subsequent customer.
 * Previous completed sessions, items, events, and transactions are NEVER deleted.
 */
export async function resetCart(cartId: string) {
  return prisma.$transaction(async (tx) => {
    await getOrCreateCart(tx, cartId);

    // Mark any existing active sessions as ABANDONED (or COMPLETED if already checked out)
    const existingActive = await tx.shoppingSession.findMany({
      where: {
        cartId,
        status: { in: ["ACTIVE", "PAYMENT_PENDING", "BILL_GENERATED"] },
      },
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
  }, TX_CONFIG);
}

export async function getOverview(): Promise<OverviewPayload> {
  if (cachedOverview && Date.now() - cachedOverview.timestamp < CACHE_TTL_MS) {
    return cachedOverview.data;
  }

  // Fetch all carts with their latest session, transactions, and session count in parallel
  const [carts, transactions, activeSessionsCount] = await Promise.all([
    prisma.cart.findMany({
      orderBy: { cartId: "asc" },
      include: {
        sessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: sessionInclude,
        },
      },
    }),
    prisma.transaction.findMany({
      where: { paymentStatus: "PAID" },
      include: {
        session: {
          include: {
            items: true,
          },
        },
      },
      orderBy: { cashierConfirmedAt: "desc" },
      take: 20,
    }),
    prisma.shoppingSession.count({
      where: { status: "ACTIVE" },
    }),
  ]);

  const cartPayloads: CartPayload[] = carts.map((cart) => {
    const session = cart.sessions[0];
    if (session) {
      return toPayload(session);
    }
    return {
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
    };
  });

  const totalRevenue = roundMoney(
    transactions.reduce((sum, tx) => sum + Number(tx.finalTotal), 0),
  );

  const pendingBillsCount = cartPayloads.filter(
    (c) =>
      c.sessionStatus === "PAYMENT_PENDING" ||
      c.sessionStatus === "BILL_GENERATED",
  ).length;

  const flaggedCartsCount = cartPayloads.filter(
    (c) => c.hasMismatch || c.status === "FLAGGED_MISMATCH",
  ).length;

  const pendingBillsList = cartPayloads.filter(
    (c) =>
      c.sessionStatus === "PAYMENT_PENDING" ||
      c.sessionStatus === "BILL_GENERATED",
  );

  const completedHistory: BillHistoryItem[] = transactions.map((t) => ({
    id: t.id,
    billNumber: t.billNumber || t.reference || `BILL-${t.id.slice(-6)}`,
    cartId: t.session?.cartId || "N/A",
    sessionId: t.sessionId,
    finalTotal: Number(t.finalTotal),
    paymentMethod: t.paymentMethod || "CASH",
    cashierConfirmedAt: t.cashierConfirmedAt
      ? t.cashierConfirmedAt.toISOString()
      : t.timestamp.toISOString(),
    itemCount: t.session?.items?.reduce((acc, i) => acc + i.quantity, 0) || 0,
  }));

  const data: OverviewPayload = {
    totalRevenue,
    activeSessions: activeSessionsCount,
    pendingBills: pendingBillsCount,
    flaggedCarts: flaggedCartsCount,
    carts: cartPayloads,
    pendingBillsList,
    completedHistory,
  };

  cachedOverview = { data, timestamp: Date.now() };
  return data;
}

export async function publishCartUpdate(cart: CartPayload) {
  invalidateCache(cart.cartId);
  cartCache.set(cart.cartId, { data: cart, timestamp: Date.now() });

  // [TROLLEY LIVE LOGS] Publishing events is not proof a browser received them.
  publish(cartChannel(cart.cartId), "cart", cart);
  const overview = await getOverview();
  publish(ADMIN_CHANNEL, "overview", overview);
  console.log("[WEBSITE UPDATE PUBLISHED]", {
    time: new Date().toISOString(),
    cartId: cart.cartId, status: cart.status,
    itemCount: cart.itemCount, totalPriceINR: cart.totalPrice,
    hasMismatch: cart.hasMismatch,
  });
}
