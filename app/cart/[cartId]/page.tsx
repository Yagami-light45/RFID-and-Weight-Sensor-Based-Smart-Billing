import { Suspense } from "react";
import { redirect } from "next/navigation";

export default function LegacyCartPage({
  params,
}: {
  params: Promise<{ cartId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <LegacyRedirect params={params} />
    </Suspense>
  );
}

async function LegacyRedirect({
  params,
}: {
  params: Promise<{ cartId: string }>;
}): Promise<null> {
  const { cartId } = await params;
  redirect(`/${cartId}`);
  return null;
}
