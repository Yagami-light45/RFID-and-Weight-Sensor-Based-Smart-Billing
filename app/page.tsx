import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { grams, inr } from "@/lib/format";

export const metadata = {
  title: "Smart Billing Trolley",
  description: "RFID and weight-sensor billing for shopping trolleys",
};

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-600">Loading store…</p>}>
      <StoreHome />
    </Suspense>
  );
}

async function StoreHome() {
  await connection();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;

  const [products, carts] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.cart.findMany({ orderBy: { cartId: "asc" } }),
  ]);

  const cartIds = carts.length > 0 ? carts.map((cart) => cart.cartId) : ["CART_01", "CART_02", "CART_03"];
  const cards = await Promise.all(
    cartIds.map(async (cartId) => {
      const href = `${base}/${cartId}`;
      const qr = await QRCode.toDataURL(href, { margin: 1, width: 168 });
      return { cartId, href, qr };
    }),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Smart billing trolleys</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-stone-600">
            Each trolley has a dedicated customer page. The ESP32 posts RFID scans and the load-cell
            weight. The bill updates live with session-based tracking, and weight mismatches flag the cart.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white"
        >
          Store overview
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <article key={card.cartId} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-mono text-sm font-semibold">{card.cartId}</h2>
              <Link href={`/${card.cartId}`} className="text-sm font-medium text-teal-800">
                Open
              </Link>
            </div>
            {/* QR codes are generated data URLs for the physical trolley label. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.qr}
              alt={`QR code for ${card.cartId}`}
              className="mx-auto mt-3 h-36 w-36"
            />
            <p className="mt-2 truncate text-center text-xs text-stone-500">{card.href}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="font-medium">Seeded products</h2>
          <p className="text-sm text-stone-500">These RFID tags are what the trolley scanner sends.</p>
        </div>
        <ul className="divide-y divide-stone-200 sm:hidden">
          {products.map((product) => (
            <li key={product.id} className="px-4 py-3">
              <p className="font-medium">{product.name}</p>
              <p className="font-mono text-xs text-stone-500">{product.rfidUid}</p>
              <p className="mt-1 text-sm text-stone-600">
                {inr(Number(product.price))} · {grams(product.expectedWeight)} · ±{grams(product.weightTolerance)}
              </p>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Tag / UID</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Weight</th>
                <th className="px-4 py-2 font-medium">Tolerance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-3 font-mono text-xs">{product.rfidUid}</td>
                  <td className="px-4 py-3">{product.name}</td>
                  <td className="px-4 py-3">{inr(Number(product.price))}</td>
                  <td className="px-4 py-3">{grams(product.expectedWeight)}</td>
                  <td className="px-4 py-3">±{grams(product.weightTolerance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="font-medium">Simulate the ESP32</h2>
        <p className="mt-1 text-sm text-stone-600">
          With the app running, this script scans, removes, and checks out without hardware.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-stone-900 px-4 py-3 text-sm text-stone-100">
          npm run simulate
        </pre>
      </section>
    </div>
  );
}
