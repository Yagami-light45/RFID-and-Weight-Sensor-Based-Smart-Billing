"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, IndianRupee, ShoppingCart } from "lucide-react";
import { grams, inr, statusText } from "@/lib/format";
import type { OverviewPayload } from "@/lib/types";

export function AdminBoard() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const data = (await response.json()) as OverviewPayload & { message?: string };
        if (!response.ok) throw new Error(data.message ?? "Could not load the store");
        if (active) apply(data);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load the store");
      });

    return () => {
      active = false;
      source.close();
    };
  }, []);

  if (!overview) {
    return <p className="text-sm text-stone-600">{error ?? "Loading store…"}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Store overview</h1>
        <span className={`text-sm ${online ? "text-teal-800" : "text-amber-800"}`}>
          {online ? "Live" : "Reconnecting"}
        </span>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm text-stone-500">
            <IndianRupee size={15} />
            Checked-out revenue
          </p>
          <p className="mt-1 text-2xl font-semibold">{inr(overview.totalRevenue)}</p>
        </article>
        <article className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm text-stone-500">
            <ShoppingCart size={15} />
            Active sessions
          </p>
          <p className="mt-1 text-2xl font-semibold">{overview.activeSessions}</p>
        </article>
        <article className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm text-stone-500">
            <AlertTriangle size={15} />
            Weight alerts
          </p>
          <p className="mt-1 text-2xl font-semibold">{overview.flaggedCarts}</p>
        </article>
      </section>

      {overview.carts.length === 0 ? (
        <p className="rounded-2xl border border-stone-200 bg-white px-4 py-8 text-sm text-stone-600">
          No trolleys yet. A cart appears here on its first scan.
        </p>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overview.carts.map((cart) => (
            <Link
              key={cart.cartId}
              href={`/cart/${cart.cartId}`}
              className={`rounded-2xl border bg-white p-4 hover:border-stone-400 ${
                cart.hasMismatch ? "border-red-300" : "border-stone-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{cart.cartId}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    cart.status === "FLAGGED_MISMATCH"
                      ? "bg-red-50 text-red-800"
                      : cart.status === "CHECKED_OUT"
                        ? "bg-teal-50 text-teal-900"
                        : "bg-stone-100 text-stone-700"
                  }`}
                >
                  {statusText(cart.status)}
                </span>
              </div>
              <p className="mt-3 text-xl font-semibold">{inr(cart.totalPrice)}</p>
              <p className="mt-1 text-sm text-stone-600">
                {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} ·{" "}
                {grams(cart.currentMeasuredWeight)} measured
              </p>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
