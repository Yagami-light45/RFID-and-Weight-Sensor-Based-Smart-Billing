"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  IndianRupee,
  QrCode,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { fullDateTime, grams, inr, statusText } from "@/lib/format";
import type { CartPayload, OverviewPayload, PaymentMethod } from "@/lib/types";

export function AdminBoard() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active Tab: "pending" | "trolleys" | "history"
  const [activeTab, setActiveTab] = useState<"pending" | "trolleys" | "history">(
    "pending",
  );

  // Cashier Verification Modal State
  const [selectedCart, setSelectedCart] = useState<CartPayload | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [referenceNotes, setReferenceNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const source = new EventSource("/api/admin/events");

    const apply = (next: OverviewPayload) => {
      setOverview(next);
      setError(null);
    };

    source.onopen = () => {
      if (active) setOnline(true);
    };
    source.onerror = () => {
      if (active) setOnline(false);
    };
    source.addEventListener("overview", (event) => {
      if (!active) return;
      setOnline(true);
      apply(JSON.parse((event as MessageEvent).data) as OverviewPayload);
    });

    fetch("/api/admin/overview", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as OverviewPayload & {
          message?: string;
        };
        if (!response.ok)
          throw new Error(data.message ?? "Could not load the store");
        if (active) apply(data);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the store",
        );
      });

    return () => {
      active = false;
      source.close();
    };
  }, []);

  async function refreshOverview() {
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as OverviewPayload;
        setOverview(data);
      }
    } catch {
      // ignore
    }
  }

  async function handleConfirmPayment() {
    if (!selectedCart) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/bills/${encodeURIComponent(selectedCart.cartId)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethod,
            reference: referenceNotes.trim() || undefined,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Payment confirmation failed");
      }
      setSuccessMsg(
        `Payment confirmed for ${selectedCart.cartId} via ${paymentMethod}! Bill marked as PAID.`,
      );
      setSelectedCart(null);
      setReferenceNotes("");
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error confirming payment");
    } finally {
      setSubmitting(false);
    }
  }

  if (!overview) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-stone-200 bg-white p-6 text-stone-600">
        <p className="text-base">{error ?? "Loading cashier console…"}</p>
      </div>
    );
  }

  const pendingBillsList =
    overview.pendingBillsList ||
    overview.carts.filter(
      (c) =>
        c.sessionStatus === "PAYMENT_PENDING" ||
        c.sessionStatus === "BILL_GENERATED" ||
        (c.transaction?.billStatus === "PENDING" && c.status !== "CHECKED_OUT"),
    );

  const completedHistory = overview.completedHistory || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800 text-white shadow-xs">
              <Store size={18} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">
              Cashier & Billing Counter
            </h1>
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Physical payment verification for Smart RFID & Weight-Sensed Trolleys
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              online
                ? "bg-teal-50 text-teal-800 border border-teal-200"
                : "bg-amber-50 text-amber-800 border border-amber-200"
            }`}
          >
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? "Live Synchronized" : "Reconnecting"}
          </span>
          <button
            type="button"
            onClick={refreshOverview}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
            title="Refresh dashboard"
          >
            <RotateCcw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {successMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-xs flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-700" />
            {successMsg}
          </span>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {/* Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
            <IndianRupee size={14} className="text-emerald-700" />
            Collected Revenue
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-stone-900">
            {inr(overview.totalRevenue)}
          </p>
          <p className="mt-1 text-xs text-stone-500">From cashier-confirmed bills</p>
        </article>

        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
            <Clock size={14} />
            Pending Counter Bills
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-amber-950">
            {pendingBillsList.length}
          </p>
          <p className="mt-1 text-xs text-stone-500">Awaiting cashier payment</p>
        </article>

        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
            <ShoppingCart size={14} className="text-teal-700" />
            Active Shopping Carts
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-stone-900">
            {overview.activeSessions}
          </p>
          <p className="mt-1 text-xs text-stone-500">Currently in aisles</p>
        </article>

        <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-xs">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-700">
            <AlertTriangle size={14} />
            Weight Mismatches
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-rose-900">
            {overview.flaggedCarts}
          </p>
          <p className="mt-1 text-xs text-stone-500">Sensor discrepancy detected</p>
        </article>
      </section>

      {/* Tabs Navigation */}
      <div className="flex border-b border-stone-200">
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
            activeTab === "pending"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          <Clock size={16} />
          Pending Bills (Counter Payment)
          {pendingBillsList.length > 0 ? (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
              {pendingBillsList.length}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("trolleys")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
            activeTab === "trolleys"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          <ShoppingCart size={16} />
          All Trolleys ({overview.carts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
            activeTab === "history"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          <FileText size={16} />
          Completed Billing History ({completedHistory.length})
        </button>
      </div>

      {/* ========================================================
          TAB 1: PENDING BILLS AWAITING CASHIER CONFIRMATION
         ======================================================== */}
      {activeTab === "pending" ? (
        <section className="space-y-3">
          {pendingBillsList.length === 0 ? (
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-12 text-center shadow-xs">
              <CheckCircle2 size={36} className="mx-auto text-emerald-600 mb-2" />
              <p className="text-base font-semibold text-stone-800">
                No bills currently awaiting payment
              </p>
              <p className="mt-1 text-xs text-stone-500 max-w-sm mx-auto">
                When a customer finishes shopping and taps &quot;Generate Final Bill&quot; on
                their phone, their verified bill will appear here for physical cashier payment.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pendingBillsList.map((cart) => {
                const sub = cart.transaction ? Number(cart.transaction.subtotal) : cart.totalPrice;
                const tot = cart.transaction
                  ? Number(cart.transaction.finalTotal)
                  : Math.round(sub * 1.05 * 100) / 100;
                const billNum =
                  cart.transaction?.billNumber ||
                  cart.transaction?.reference ||
                  `BILL-${cart.cartId}`;
                const diff = Math.abs(cart.currentMeasuredWeight - cart.totalExpectedWeight);
                const isWeightMatch = diff <= 15;

                return (
                  <div
                    key={cart.cartId}
                    className="flex flex-col justify-between rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-4 shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-base font-bold text-stone-900">
                          {cart.cartId}
                        </span>
                        <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                          Payment Pending
                        </span>
                      </div>

                      <div className="mt-2 text-xs font-mono text-stone-600">
                        <p className="font-semibold text-stone-800">{billNum}</p>
                        <p className="text-[11px] text-stone-500">
                          Session: {cart.sessionId?.slice(-8)} · {cart.itemCount} items
                        </p>
                      </div>

                      <div className="mt-3 rounded-lg border border-stone-200 bg-white p-2.5 text-xs">
                        <div className="flex justify-between items-center text-stone-700">
                          <span>Subtotal:</span>
                          <span className="font-mono font-medium">{inr(sub)}</span>
                        </div>
                        <div className="flex justify-between items-center text-stone-700 mt-1">
                          <span>Final Payable (inc. GST):</span>
                          <span className="font-mono text-sm font-bold text-emerald-800">
                            {inr(tot)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between text-xs text-stone-600">
                        <span className="flex items-center gap-1">
                          <Scale size={13} />
                          Sensors:
                        </span>
                        <span
                          className={`font-semibold ${
                            isWeightMatch ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {isWeightMatch
                            ? "Verified Match"
                            : `Discrepancy (${grams(diff)})`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-amber-200">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCart(cart);
                          setPaymentMethod("CASH");
                          setReferenceNotes("");
                        }}
                        className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-900"
                      >
                        <UserCheck size={16} />
                        Verify & Collect Payment
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* ========================================================
          TAB 2: ALL TROLLEYS OVERVIEW
         ======================================================== */}
      {activeTab === "trolleys" ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overview.carts.map((cart) => (
            <Link
              key={cart.cartId}
              href={`/${cart.cartId}`}
              className={`rounded-2xl border bg-white p-4 shadow-xs hover:border-stone-400 transition-all ${
                cart.hasMismatch ? "border-red-300" : "border-stone-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-bold text-stone-900">
                  {cart.cartId}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    cart.status === "FLAGGED_MISMATCH"
                      ? "bg-red-50 text-red-800 border border-red-200"
                      : cart.status === "CHECKED_OUT"
                        ? "bg-teal-50 text-teal-900 border border-teal-200"
                        : cart.sessionStatus === "PAYMENT_PENDING"
                          ? "bg-amber-50 text-amber-900 border border-amber-200"
                          : "bg-stone-100 text-stone-700 border border-stone-200"
                  }`}
                >
                  {statusText(cart.status)}
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight text-stone-900">
                {inr(cart.totalPrice)}
              </p>
              <p className="mt-1 text-xs text-stone-600">
                {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} ·{" "}
                {grams(cart.currentMeasuredWeight)} scale
              </p>
              <p className="mt-2 text-[11px] text-stone-400 font-mono">
                Session: {cart.sessionId?.slice(-8) || "None"}
              </p>
            </Link>
          ))}
        </section>
      ) : null}

      {/* ========================================================
          TAB 3: COMPLETED BILLING HISTORY
         ======================================================== */}
      {activeTab === "history" ? (
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs">
          {completedHistory.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-stone-500">
              No completed bills recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50/70 text-xs font-semibold uppercase tracking-wider text-stone-500">
                    <th className="py-3 px-4">Bill Number</th>
                    <th className="py-3 px-4">Trolley</th>
                    <th className="py-3 px-4">Items</th>
                    <th className="py-3 px-4">Payment Method</th>
                    <th className="py-3 px-4">Confirmed Date & Time</th>
                    <th className="py-3 px-4 text-right">Amount Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {completedHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-stone-50/50">
                      <td className="py-3 px-4 font-mono font-medium text-stone-900">
                        {h.billNumber}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{h.cartId}</td>
                      <td className="py-3 px-4">{h.itemCount} items</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-800">
                          {h.paymentMethod === "CASH" ? (
                            <Banknote size={12} />
                          ) : h.paymentMethod === "CARD" ? (
                            <CreditCard size={12} />
                          ) : (
                            <QrCode size={12} />
                          )}
                          {h.paymentMethod}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-600">
                        {fullDateTime(h.cashierConfirmedAt)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-800">
                        {inr(h.finalTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ========================================================
          CASHIER VERIFICATION & PAYMENT MODAL
         ======================================================== */}
      {selectedCart ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 bg-stone-50">
              <div>
                <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-teal-800" />
                  Cashier Counter Payment Verification
                </h2>
                <p className="text-xs text-stone-500 font-mono">
                  Trolley: {selectedCart.cartId} · Session: {selectedCart.sessionId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCart(null)}
                className="rounded-lg p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Load Cell Weight Status Check */}
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-stone-700">
                    <Scale size={16} />
                    <span className="font-semibold">Weight Verification:</span>
                    <span>Expected {grams(selectedCart.totalExpectedWeight)}</span>
                    <span>· Scale {grams(selectedCart.currentMeasuredWeight)}</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-xs ${
                      !selectedCart.hasMismatch
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {!selectedCart.hasMismatch ? (
                      <ShieldCheck size={13} />
                    ) : (
                      <ShieldAlert size={13} />
                    )}
                    {!selectedCart.hasMismatch ? "Verified Match" : "Discrepancy"}
                  </span>
                </div>
              </div>

              {/* Products in Cart */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                  Scanned Products ({selectedCart.items.length})
                </p>
                <div className="rounded-xl border border-stone-200 divide-y divide-stone-100 max-h-40 overflow-y-auto">
                  {selectedCart.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-3 py-2 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-stone-900">{item.name}</p>
                        <p className="font-mono text-[10px] text-stone-400">
                          Qty: {item.quantity} · {grams(item.lineWeight)}
                        </p>
                      </div>
                      <p className="font-mono font-semibold text-stone-800">
                        {inr(item.subtotal)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bill Totals Breakdown */}
              <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 space-y-1.5 text-xs">
                <div className="flex justify-between text-stone-600">
                  <span>Subtotal:</span>
                  <span className="font-mono">
                    {inr(
                      selectedCart.transaction
                        ? Number(selectedCart.transaction.subtotal)
                        : selectedCart.totalPrice,
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-stone-600">
                  <span>Applicable GST (5%):</span>
                  <span className="font-mono">
                    {inr(
                      selectedCart.transaction
                        ? Number(selectedCart.transaction.tax)
                        : Math.round(selectedCart.totalPrice * 0.05 * 100) / 100,
                    )}
                  </span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-2 text-sm font-bold text-stone-900">
                  <span>Final Payable Total:</span>
                  <span className="font-mono text-base text-emerald-800">
                    {inr(
                      selectedCart.transaction
                        ? Number(selectedCart.transaction.finalTotal)
                        : Math.round(selectedCart.totalPrice * 1.05 * 100) / 100,
                    )}
                  </span>
                </div>
              </div>

              {/* Payment Method Selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-2">
                  Select Physical Payment Method Received at Counter *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("CASH")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                      paymentMethod === "CASH"
                        ? "border-teal-700 bg-teal-50 text-teal-900 ring-2 ring-teal-700"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <Banknote size={22} className={paymentMethod === "CASH" ? "text-teal-800" : "text-stone-500"} />
                    <span className="text-xs font-bold">Cash</span>
                    <span className="text-[10px] text-stone-500">Physical notes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod("CARD")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                      paymentMethod === "CARD"
                        ? "border-teal-700 bg-teal-50 text-teal-900 ring-2 ring-teal-700"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <CreditCard size={22} className={paymentMethod === "CARD" ? "text-teal-800" : "text-stone-500"} />
                    <span className="text-xs font-bold">POS Card</span>
                    <span className="text-[10px] text-stone-500">Swipe/Dip machine</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod("UPI")}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                      paymentMethod === "UPI"
                        ? "border-teal-700 bg-teal-50 text-teal-900 ring-2 ring-teal-700"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <QrCode size={22} className={paymentMethod === "UPI" ? "text-teal-800" : "text-stone-500"} />
                    <span className="text-xs font-bold">Store UPI QR</span>
                    <span className="text-[10px] text-stone-500">Counter QR Code</span>
                  </button>
                </div>
              </div>

              {/* Reference / Transaction ID */}
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Reference Note / Transaction ID (Optional)
                </label>
                <input
                  type="text"
                  value={referenceNotes}
                  onChange={(e) => setReferenceNotes(e.target.value)}
                  placeholder={
                    paymentMethod === "CASH"
                      ? "e.g. Cash received in counter drawer"
                      : paymentMethod === "CARD"
                        ? "e.g. POS Auth Code / Approval Code"
                        : "e.g. UPI UTR / Transaction reference"
                  }
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-800 placeholder-stone-400 focus:border-teal-700 focus:outline-hidden"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-stone-200 px-6 py-4 bg-stone-50">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setSelectedCart(null)}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmPayment}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-800 px-5 py-2 text-xs font-semibold text-white shadow hover:bg-teal-900 disabled:opacity-50"
              >
                <CheckCircle2 size={15} />
                {submitting ? "Confirming..." : `Confirm ${paymentMethod} & Complete Bill`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
