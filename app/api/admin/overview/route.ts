import { getOverview } from "@/lib/cart";
import { withApi } from "@/lib/http";

export async function GET() {
  return withApi(async () => Response.json(await getOverview()));
}
