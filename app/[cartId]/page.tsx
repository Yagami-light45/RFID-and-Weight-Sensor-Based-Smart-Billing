import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CartDashboard } from "@/components/cart-dashboard";
import { isCartId } from "@/lib/ids";

export const metadata = {
  title: "Cart dashboard",
};

const RESERVED_ROUTES = new Set(["admin", "api", "cart", "favicon.ico"]);

export default function RootCartPage({
  params,
}: {
  params: Promise<{ cartId: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-stone-600">Loading cart…</p>}>
      <CartGate params={params} />
    </Suspense>
  );
}

async function CartGate({
  params,
}: {
  params: Promise<{ cartId: string }>;
}) {
  const { cartId } = await params;
  if (RESERVED_ROUTES.has(cartId.toLowerCase())) {
    notFound();
  }

  if (!isCartId(cartId)) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        That cart id is not valid. Use letters, numbers, underscores, or hyphens.
      </p>
    );
  }

  return <CartDashboard key={cartId} cartId={cartId} />;
}
