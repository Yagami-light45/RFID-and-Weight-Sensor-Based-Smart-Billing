"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CreditCard,
  RotateCcw,
  Scale,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { clock, grams, inr } from "@/lib/format";
import type { CartPayload, PaymentMethod } from "@/lib/types";

type Receipt = {
  reference: string;
  paymentMethod: PaymentMethod;
  total: number;
};

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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

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
      if (next.status === "CHECKED_OUT" && next.transaction) {
        setReceipt({
          reference: next.transaction.reference,
          paymentMethod: next.transaction.paymentMethod as PaymentMethod,
          total: next.transaction.finalTotal,
        });
      } else {
        setReceipt((current) => (next.status === "CHECKED_OUT" ? current : null));
      }
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
        const data = (await response.json()) as CartPayload & { message?: string };
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

  useEffect(() => {
    if (!checkoutOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCheckoutOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkoutOpen]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const data = await request(`/api/cart/${encodeURIComponent(cartId)}`, "GET");
    setCart(data as unknown as CartPayload);
  }

  if (!cart) {
    return (
      <p className="text-sm text-stone-600">
        {error ?? "Loading cart…"}
      </p>
    );
  }

  const matched = weightMatches(cart);
  const checkedOut = cart.status === "CHECKED_OUT";
  const offBy = Math.abs(cart.currentMeasuredWeight - cart.totalExpectedWeight);
  const scaleMax = Math.max(
    cart.totalExpectedWeight,
    cart.currentMeasuredWeight,
    1,
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-stone-900 px-3 py-1 font-mono text-sm font-medium text-white">
            {cart.cartId}
          </span>
          {cart.sessionId ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 font-mono text-xs text-stone-600"
              title={`Active Session: ${cart.sessionId}`}
            >
              <span className="font-sans text-stone-400">Session:</span>
              <span>{cart.sessionId.slice(-8)}</span>
            </span>
          ) : null}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
              online ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"
            }`}
          >
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <span
          className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
            cart.hasMismatch
              ? "bg-red-50 text-red-800"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {cart.hasMismatch ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
          {cart.hasMismatch ? "Weight discrepancy" : "Normal"}
        </span>
      </header>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {checkedOut ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          {receipt
            ? `${receipt.paymentMethod} payment confirmed. Reference ${receipt.reference}.`
            : "This trolley is checked out."}{" "}
          Bill {inr(receipt?.total ?? cart.totalPrice)}.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-500">Running bill</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight" aria-live="polite">
            {inr(cart.totalPrice)}
          </p>
        </article>
        <article className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-500">Items</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{cart.itemCount}</p>
        </article>
        <article className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm text-stone-500">
            <Scale size={15} />
            Expected vs measured
          </p>
          <p className="mt-1 text-sm font-medium text-stone-800">
            {grams(cart.totalExpectedWeight)} expected
          </p>
          <p className="text-sm text-stone-600">
            {grams(cart.currentMeasuredWeight)} on the scale
            {offBy > 0.05 ? ` · off by ${grams(offBy)}` : ""}
          </p>
          <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full ${cart.hasMismatch ? "bg-red-600" : "bg-teal-700"}`}
              style={{
                width: `${(cart.currentMeasuredWeight / scaleMax) * 100}%`,
              }}
            />
            <div
              className="absolute top-0 h-full w-0.5 bg-stone-900"
              style={{
                left: `${(cart.totalExpectedWeight / scaleMax) * 100}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-stone-500">The dark mark is the expected weight.</p>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1.5fr)_0.7fr_0.4fr_0.9fr_0.8fr_auto] gap-3 border-b border-stone-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-stone-500 sm:grid">
          <span>Item</span>
          <span>Price</span>
          <span>Qty</span>
          <span>Weight</span>
          <span>Subtotal</span>
          <span className="sr-only">Remove</span>
        </div>
        {cart.items.length === 0 ? (
          <p className="px-4 py-8 text-sm text-stone-600">
            No items yet. Scan a product on the trolley RFID reader.
          </p>
        ) : (
          <ul className="divide-y divide-stone-200">
            {cart.items.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.5fr)_0.7fr_0.4fr_0.9fr_0.8fr_auto] sm:items-center"
              >
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="font-mono text-xs text-stone-500">{item.rfidUid || item.rfidTag}</p>
                </div>
                <p className="text-sm text-stone-700">
                  <span className="text-stone-500 sm:hidden">Price </span>
                  {inr(item.unitPrice)}
                </p>
                <p className="text-sm text-stone-700">
                  <span className="text-stone-500 sm:hidden">Qty </span>
                  {item.quantity}
                </p>
                <p className="text-sm text-stone-700">
                  <span className="text-stone-500 sm:hidden">Weight </span>
                  {grams(item.expectedWeight)}
                  {item.quantity > 1 ? ` · ${grams(item.lineWeight)}` : ""}
                </p>
                <p className="text-sm font-medium">
                  <span className="font-normal text-stone-500 sm:hidden">Subtotal </span>
                  {inr(item.subtotal)}
                </p>
                <button
                  type="button"
                  disabled={busy || checkedOut}
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
                  className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-stone-300 px-3 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50 sm:col-span-1"
                >
                  <Trash2 size={15} />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-stone-500">Updated {clock(cart.updatedAt)}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await request(`/api/cart/${encodeURIComponent(cartId)}/reset`, "POST");
                setReceipt(null);
                setCheckoutOpen(false);
                await refresh();
              })
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            <RotateCcw size={16} />
            New session
          </button>
          <button
            type="button"
            disabled={busy || checkedOut || cart.items.length === 0}
            onClick={() => setCheckoutOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-800 px-4 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-50"
          >
            Checkout
          </button>
        </div>
      </section>

      {checkoutOpen ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="checkout-title" className="text-lg font-semibold">
              Checkout verification
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              Expected {grams(cart.totalExpectedWeight)}. Scale reads{" "}
              {grams(cart.currentMeasuredWeight)}. Allowed difference{" "}
              {grams(toleranceOf(cart))}.
            </p>
            {matched ? (
              <p className="mt-3 text-sm text-emerald-800">
                Weight matches. Choose a demo payment method.
              </p>
            ) : (
              <p className="mt-3 text-sm text-red-800">
                Weight does not match. Payment stays closed and the cart is flagged
                for a cashier.
              </p>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {matched ? (
                <>
                  <PayButton
                    label="Pay with UPI"
                    icon={<Smartphone size={16} />}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await pay(cart, "UPI", setReceipt, setCheckoutOpen);
                        await refresh();
                      })
                    }
                  />
                  <PayButton
                    label="Pay with card"
                    icon={<CreditCard size={16} />}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await pay(cart, "CARD", setReceipt, setCheckoutOpen);
                        await refresh();
                      })
                    }
                  />
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const data = await request(
                        `/api/cart/${encodeURIComponent(cart.cartId)}/checkout`,
                        "POST",
                        { measuredWeight: cart.currentMeasuredWeight },
                      );
                      setCheckoutOpen(false);
                      if (typeof data.message === "string") setError(data.message);
                      await refresh();
                    })
                  }
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 sm:col-span-2"
                >
                  Flag for cashier
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCheckoutOpen(false)}
              className="mt-3 h-10 w-full rounded-lg text-sm text-stone-600 hover:bg-stone-100"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PayButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

async function pay(
  cart: CartPayload,
  paymentMethod: PaymentMethod,
  setReceipt: (receipt: Receipt) => void,
  setCheckoutOpen: (open: boolean) => void,
) {
  const data = await request(
    `/api/cart/${encodeURIComponent(cart.cartId)}/checkout`,
    "POST",
    { measuredWeight: cart.currentMeasuredWeight, paymentMethod },
  );
  if (data.status === "CHECKED_OUT" && typeof data.reference === "string") {
    setReceipt({
      reference: data.reference,
      paymentMethod,
      total: Number(data.total),
    });
    setCheckoutOpen(false);
    return;
  }
  if (typeof data.message === "string") {
    throw new Error(data.message);
  }
}
