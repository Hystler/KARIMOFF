import { getOrderOutboxEvents } from "@/lib/order-flow/queries";
import { listenOrderOutboxNotifications } from "@/lib/order-flow/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM_LIFETIME_MS = 25_000;
const RECOVERY_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 12_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locationId = url.searchParams.get("location") ?? "";
  if (!LOCATION_PATTERN.test(locationId)) {
    return Response.json({ error: "Некорректная точка." }, { status: 400 });
  }

  const headerCursor = Number(request.headers.get("last-event-id") ?? 0);
  const queryCursor = Number(url.searchParams.get("after") ?? 0);
  let cursor = Math.max(
    Number.isFinite(headerCursor) ? headerCursor : 0,
    Number.isFinite(queryCursor) ? queryCursor : 0
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let active = true;
      let flushing = false;
      let flushAgain = false;
      controller.enqueue(encoder.encode("retry: 3000\nevent: ready\ndata: {}\n\n"));

      async function flushEvents() {
        if (!active) return;
        if (flushing) {
          flushAgain = true;
          return;
        }
        flushing = true;
        try {
          do {
            flushAgain = false;
            const events = await getOrderOutboxEvents({ afterId: cursor, locationId });
            for (const event of events) {
              if (!active) return;
              cursor = Number(event.id);
              controller.enqueue(encoder.encode(
                `id: ${cursor}\nevent: order\ndata: ${JSON.stringify({ type: event.event_type })}\n\n`
              ));
            }
          } while (flushAgain && active);
        } catch {
          if (active) controller.enqueue(encoder.encode("event: unavailable\ndata: {}\n\n"));
        } finally {
          flushing = false;
        }
      }

      const unsubscribe = await listenOrderOutboxNotifications(() => void flushEvents());
      await flushEvents();
      const recoveryTimer = setInterval(() => void flushEvents(), RECOVERY_INTERVAL_MS);
      const heartbeatTimer = setInterval(() => {
        if (active) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, HEARTBEAT_INTERVAL_MS);

      const close = () => {
        if (!active) return;
        active = false;
        clearInterval(recoveryTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(lifetimeTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      const lifetimeTimer = setTimeout(close, STREAM_LIFETIME_MS);
      request.signal.addEventListener("abort", close, { once: true });
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no"
    }
  });
}
