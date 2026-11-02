"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Printer,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { fullDateTime, grams, inr } from "@/lib/format";
import type { CartPayload } from "@/lib/types";

function toleranceOf(cart: CartPayload) {
  if (cart.items.length === 0) return 15;
  return Math.max(...cart.items.map((item) => item.weightTolerance));
}

function weightMatches(cart: CartPayload) {
  const difference = Math.abs(
    cart.currentMeasuredWeight - cart.totalExpectedWeight,
  );
  return difference - toleranceOf(cart) <= 1e-6;
}

async function request(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof data.message === "string" ? data.message : "Request failed";
    throw new Error(message);
  }
  return data;
}

export function CartDashboard({ cartId }: { cartId: string }) {
  const [cart, setCart] = useState<CartPayload | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let gotCart = false;
    const source = new EventSource(
      `/api/cart/${encodeURIComponent(cartId)}/events`,
    );

    const apply = (next: CartPayload) => {
      gotCart = true;
      setCart(next);
      setError(null);
    };

    source.onopen = () => {
      if (active) setOnline(true);
    };
    source.onerror = () => {
      if (active) setOnline(false);
    };
    source.addEventListener("cart", (event) => {
      if (!active) return;
      setOnline(true);
      apply(JSON.parse((event as MessageEvent).data) as CartPayload);
    });

    fetch(`/api/cart/${encodeURIComponent(cartId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as CartPayload & {
          message?: string;
        };
        if (!response.ok) {
          throw new Error(data.message ?? "Could not load this cart");
        }
        if (active) apply(data);
      })
      .catch((loadError: unknown) => {
        if (!active || gotCart) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load this cart",
        );
      });

    return () => {
      active = false;
      source.close();
    };
  }, [cartId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const data = await request(`/api/cart/${encodeURIComponent(cartId)}`, "GET");
    setCart(data as unknown as CartPayload);
  }

  async function handleGenerateBill() {
    if (!cart) return;
    run(async () => {
      const data = await request(
        `/api/cart/${encodeURIComponent(cartId)}/bill`,
        "POST",
        { measuredWeight: cart.currentMeasuredWeight },
      );
      if (data.status === "FLAGGED") {
        setError(
          typeof data.message === "string"
            ? data.message
            : "Weight discrepancy detected. Please verify cart items before generating bill.",
        );
      }
      await refresh();
    });
  }

  async function handleReset() {
    run(async () => {
      await request(`/api/cart/${encodeURIComponent(cartId)}/reset`, "POST");
      await refresh();
    });
  }

  if (!cart) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-stone-200 bg-white p-6 text-stone-600">
        <p className="text-base">{error ?? "Loading smart cart…"}</p>
      </div>
    );
  }

  const isMatched = weightMatches(cart);
  const isCheckedOut =
    cart.status === "CHECKED_OUT" || cart.sessionStatus === "COMPLETED";
  const isPaymentPending =
    cart.sessionStatus === "PAYMENT_PENDING" ||
    cart.sessionStatus === "BILL_GENERATED" ||
    (cart.transaction?.billStatus === "PENDING" && !isCheckedOut);

  const offBy = Math.abs(cart.currentMeasuredWeight - cart.totalExpectedWeight);
  const scaleMax = Math.max(
    cart.totalExpectedWeight,
    cart.currentMeasuredWeight,
    1,
  );

  const tx = cart.transaction;
  const billNumber =
    tx?.billNumber ||
    tx?.reference ||
    `BILL-${cart.cartId}-${cart.sessionId ? cart.sessionId.slice(-6).toUpperCase() : "PENDING"}`;
  const subtotal = tx ? Number(tx.subtotal) : cart.totalPrice;
  const tax = tx ? Number(tx.tax) : Math.round(subtotal * 0.05 * 100) / 100;
  const discount = tx ? Number(tx.discount) : 0;
  const finalTotal = tx ? Number(tx.finalTotal) : subtotal + tax - discount;

  return (
    <div className="space-y-4">
      {/* Top Cart Status Header */}
      <header className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between no-print shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-stone-900 px-3.5 py-1 font-mono text-sm font-semibold text-white tracking-wide">
            {cart.cartId}
          </span>
          {cart.sessionId ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 font-mono text-xs text-stone-600 border border-stone-200"
              title={`Active Session: ${cart.sessionId}`}
            >
              <span className="font-sans text-stone-400">Session:</span>
              <span className="font-semibold">{cart.sessionId.slice(-8)}</span>
            </span>
          ) : null}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              online
                ? "bg-teal-50 text-teal-800 border border-teal-200"
                : "bg-amber-50 text-amber-800 border border-amber-200"
            }`}
          >
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? "Live ESP32 Link" : "Offline"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
              isCheckedOut
                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                : isPaymentPending
                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                  : cart.hasMismatch
                    ? "bg-rose-100 text-rose-800 border border-rose-300"
                    : "bg-teal-50 text-teal-800 border border-teal-200"
            }`}
          >
            {isCheckedOut ? (
              <CheckCircle2 size={14} />
            ) : isPaymentPending ? (
              <Clock size={14} />
            ) : cart.hasMismatch ? (
              <AlertTriangle size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            {isCheckedOut
              ? "Payment Completed"
              : isPaymentPending
                ? "Awaiting Counter Payment"
                : cart.hasMismatch
                  ? "Weight Discrepancy"
                  : "Active Shopping"}
          </span>
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm no-print">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ========================================================
          1. COMPLETED SCREEN (When Cashier Confirms Payment)
         ======================================================== */}
      {isCheckedOut ? (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md">
              <CheckCircle2 size={32} />
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-emerald-950">
              Payment Confirmed & Verified!
            </h2>
            <p className="mt-1 max-w-md text-sm text-emerald-800">
              Your payment has been verified by the cashier at the physical counter.
              Thank you for shopping with us!
            </p>

            <div className="mt-5 w-full max-w-md rounded-xl border border-emerald-200 bg-white p-4 text-left shadow-sm">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-stone-500">Bill Number</span>
                  <p className="font-mono font-semibold text-stone-900">{billNumber}</p>
                </div>
                <div>
                  <span className="text-stone-500">Payment Method</span>
                  <p className="font-semibold text-stone-900">
                    {tx?.paymentMethod || "Physical Counter Payment"}
                  </p>
                </div>
                <div>
                  <span className="text-stone-500">Total Paid</span>
                  <p className="text-lg font-bold text-emerald-700">{inr(finalTotal)}</p>
                </div>
                <div>
                  <span className="text-stone-500">Confirmed At</span>
                  <p className="text-xs font-medium text-stone-700">
                    {tx?.cashierConfirmedAt ? fullDateTime(tx.cashierConfirmedAt) : "Just now"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-stone-900 px-5 text-sm font-medium text-white shadow hover:bg-stone-800"
              >
                <Printer size={16} />
                Print / Download PDF Receipt
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleReset}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                <RotateCcw size={16} />
                Start New Shopping Session
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========================================================
          2. BILL GENERATED VIEW (Awaiting Counter Payment)
         ======================================================== */}
      {isPaymentPending && !isCheckedOut ? (
        <div className="space-y-4">
          {/* Prominent Counter Instruction Banner */}
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm no-print">
            <div className="flex items-start gap-3">
              <Store className="h-6 w-6 text-amber-800 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-amber-950">
                  Please proceed to the billing counter to complete your payment
                </h3>
                <p className="mt-1 text-sm text-amber-900">
                  Your final bill is generated and verified with load cell sensors.
                  Present this trolley at the store&apos;s physical counter.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-stone-800 border border-amber-200 shadow-xs">
                    💵 Cash
                  </span>
                  <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-stone-800 border border-amber-200 shadow-xs">
                    💳 Card (POS Machine)
                  </span>
                  <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-stone-800 border border-amber-200 shadow-xs">
                    📱 UPI (Store Counter QR Code)
                  </span>
                </div>
                <p className="mt-2 text-xs text-amber-800 font-medium">
                  The cashier will verify your physical payment and finalize your session.
                </p>
              </div>
            </div>
          </div>

          {/* Customer Viewable & Printable Tax Invoice Bill */}
          <div className="printable-bill rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            {/* Bill Header */}
            <div className="border-b border-stone-200 pb-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <span className="inline-block rounded bg-stone-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
                    Tax Invoice / Smart Bill
                  </span>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">
                    Smart Retail Store
                  </h2>
                  <p className="text-xs text-stone-500">RFID & Weight Sensor Automated Checkout</p>
                </div>
                <div className="text-left sm:text-right font-mono text-xs text-stone-600">
                  <p className="text-sm font-bold text-stone-900">Bill #: {billNumber}</p>
                  <p>Trolley: {cart.cartId}</p>
                  <p>Session: {cart.sessionId}</p>
                  <p>Date: {fullDateTime(tx?.createdAt || cart.updatedAt)}</p>
                </div>
              </div>
            </div>

            {/* Weight Sensor Verification Card on Bill */}
            <div className="my-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5 text-xs text-stone-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Scale size={16} className="text-stone-600" />
                  <span className="font-semibold text-stone-900">Sensor Verification:</span>
                  <span>Expected: {grams(cart.totalExpectedWeight)}</span>
                  <span>·</span>
                  <span>Measured: {grams(cart.currentMeasuredWeight)}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold text-xs ${
                    isMatched
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-rose-100 text-rose-800 border border-rose-300"
                  }`}
                >
                  {isMatched ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                  {isMatched ? "Weight Verified Match" : "Weight Discrepancy"}
                </span>
              </div>
            </div>

            {/* Itemized Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-stone-500">
                    <th className="py-2.5">Item</th>
                    <th className="py-2.5 text-center">Qty</th>
                    <th className="py-2.5 text-right">Unit Price</th>
                    <th className="py-2.5 text-right">Weight</th>
                    <th className="py-2.5 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {cart.items.map((item) => (
                    <tr key={item.id} className="hover:bg-stone-50/50">
                      <td className="py-2.5 pr-2">
                        <p className="font-medium text-stone-900">{item.name}</p>
                        <p className="font-mono text-[10px] text-stone-400">
                          {item.rfidUid || item.rfidTag}
                        </p>
                      </td>
                      <td className="py-2.5 text-center">{item.quantity}</td>
                      <td className="py-2.5 text-right font-mono text-stone-700">
                        {inr(item.unitPrice)}
                      </td>
                      <td className="py-2.5 text-right text-xs text-stone-500">
                        {grams(item.lineWeight)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-medium text-stone-900">
                        {inr(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calculations & Totals */}
            <div className="mt-5 border-t border-stone-200 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="text-xs text-stone-500 max-w-xs">
                  <p className="font-medium text-stone-700">Counter Payment Note</p>
                  <p className="mt-0.5">
                    This bill is pending verification at the store counter. Please show this screen
                    or printed slip to the cashier.
                  </p>
                </div>
                <div className="w-full sm:w-64 space-y-1.5 text-sm">
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal</span>
                    <span className="font-mono">{inr(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>GST Tax (5%)</span>
                    <span className="font-mono">{inr(tax)}</span>
                  </div>
                  {discount > 0 ? (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount</span>
                      <span className="font-mono">-{inr(discount)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-bold text-stone-900">
                    <span>Final Amount</span>
                    <span className="font-mono text-lg text-emerald-800">{inr(finalTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bill Actions (Print / PDF) */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
              >
                <Printer size={15} />
                Print / Save PDF Bill
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={refresh}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-stone-300 px-3.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  <RotateCcw size={14} />
                  Refresh Payment Status
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========================================================
          3. ACTIVE SHOPPING CART VIEW
         ======================================================== */}
      {!isCheckedOut && !isPaymentPending ? (
        <>
          {/* Running Bill Metrics */}
          <section className="grid gap-3 sm:grid-cols-3 no-print">
            <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
              <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Running Bill Total
              </p>
              <p
                className="mt-1 text-2xl font-bold tracking-tight text-stone-900"
                aria-live="polite"
              >
                {inr(cart.totalPrice)}
              </p>
              <p className="mt-0.5 text-xs text-stone-500">Excl. applicable GST</p>
            </article>

            <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
              <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Cart Items
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-stone-900">
                {cart.itemCount} {cart.itemCount === 1 ? "unit" : "units"}
              </p>
              <p className="mt-0.5 text-xs text-stone-500">
                {cart.items.length} unique {cart.items.length === 1 ? "product" : "products"}
              </p>
            </article>

            <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-stone-500">
                <Scale size={14} />
                Load Cell Weight Verification
              </p>
              <p className="mt-1 text-sm font-semibold text-stone-800">
                {grams(cart.totalExpectedWeight)} expected
              </p>
              <p className="text-xs text-stone-600">
                {grams(cart.currentMeasuredWeight)} on scale
                {offBy > 0.05 ? ` · diff ${grams(offBy)}` : ""}
              </p>
              <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-stone-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    cart.hasMismatch ? "bg-rose-600" : "bg-teal-700"
                  }`}
                  style={{
                    width: `${Math.min(100, (cart.currentMeasuredWeight / scaleMax) * 100)}%`,
                  }}
                />
                <div
                  className="absolute top-0 h-full w-0.5 bg-stone-900"
                  style={{
                    left: `${Math.min(100, (cart.totalExpectedWeight / scaleMax) * 100)}%`,
                  }}
                />
              </div>
            </article>
          </section>

          {/* Items List */}
          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs no-print">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_0.7fr_0.4fr_0.9fr_0.8fr_auto] gap-3 border-b border-stone-200 bg-stone-50/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500 sm:grid">
              <span>Product</span>
              <span>Unit Price</span>
              <span>Qty</span>
              <span>Weight</span>
              <span>Subtotal</span>
              <span className="sr-only">Actions</span>
            </div>

            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center text-stone-500">
                <ShoppingBag size={36} className="text-stone-300 mb-2" />
                <p className="text-base font-medium text-stone-700">Your smart cart is empty</p>
                <p className="text-xs text-stone-500 mt-1 max-w-sm">
                  Drop products into the trolley. The RFID reader and weight sensors will
                  automatically add items in real time.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-stone-200">
                {cart.items.map((item) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.5fr)_0.7fr_0.4fr_0.9fr_0.8fr_auto] sm:items-center hover:bg-stone-50/50"
                  >
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="truncate font-semibold text-stone-900">{item.name}</p>
                      <p className="font-mono text-xs text-stone-400">
                        RFID: {item.rfidUid || item.rfidTag}
                      </p>
                    </div>
                    <p className="text-sm text-stone-700 font-mono">
                      <span className="text-stone-400 sm:hidden">Price: </span>
                      {inr(item.unitPrice)}
                    </p>
                    <p className="text-sm font-medium text-stone-800">
                      <span className="text-stone-400 sm:hidden">Qty: </span>
                      {item.quantity}
                    </p>
                    <p className="text-sm text-stone-600">
                      <span className="text-stone-400 sm:hidden">Weight: </span>
                      {grams(item.expectedWeight)}
                      {item.quantity > 1 ? ` (${grams(item.lineWeight)})` : ""}
                    </p>
                    <p className="text-sm font-bold font-mono text-stone-900">
                      <span className="font-normal text-stone-400 sm:hidden">Subtotal: </span>
                      {inr(item.subtotal)}
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await request(
                            `/api/cart/${encodeURIComponent(cartId)}/items/${item.id}`,
                            "DELETE",
                            { measuredWeight: cart.currentMeasuredWeight },
                          );
                          await refresh();
                        })
                      }
                      className="col-span-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-stone-200 px-3 text-xs font-medium text-stone-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50 sm:col-span-1"
                    >
                      <Trash2 size={13} />
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Bottom Action Footer */}
          <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between shadow-xs no-print">
            <p className="text-xs text-stone-500">
              Updated {fullDateTime(cart.updatedAt)}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={busy}
                onClick={handleReset}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                <RotateCcw size={16} />
                Reset Session
              </button>

              <button
                type="button"
                disabled={busy || cart.items.length === 0}
                onClick={handleGenerateBill}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-800 px-5 text-sm font-semibold text-white shadow-sm hover:bg-teal-900 disabled:opacity-50 cursor-pointer"
              >
                <FileText size={16} />
                Generate Final Bill
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
