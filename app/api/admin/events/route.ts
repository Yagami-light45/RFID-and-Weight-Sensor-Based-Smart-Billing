import { getOverview } from "@/lib/cart";
import { withApi } from "@/lib/http";
import { ADMIN_CHANNEL } from "@/lib/realtime";
import { eventStream } from "@/lib/sse";

export async function GET() {
  return withApi(async () => {
    const overview = await getOverview();
    return eventStream(ADMIN_CHANNEL, [{ event: "overview", data: overview }]);
  });
}
