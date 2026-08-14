import { getOrderOutboxEvents } from "@/lib/order-flow/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM_LIFETIME_MS = 25_000;
const POLL_INTERVAL_MS = 2_500;

function sleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

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
      const startedAt = Date.now();
      controller.enqueue(encoder.encode("retry: 3000\nevent: ready\ndata: {}\n\n"));
      try {
        while (!request.signal.aborted && Date.now() - startedAt < STREAM_LIFETIME_MS) {
          const events = await getOrderOutboxEvents({ afterId: cursor, locationId });
          for (const event of events) {
            cursor = Number(event.id);
            controller.enqueue(encoder.encode(
              `id: ${cursor}\nevent: order\ndata: ${JSON.stringify({ type: event.event_type })}\n\n`
            ));
          }
          if (!events.length) controller.enqueue(encoder.encode(": heartbeat\n\n"));
          await sleep(POLL_INTERVAL_MS, request.signal);
        }
      } catch {
        controller.enqueue(encoder.encode("event: unavailable\ndata: {}\n\n"));
      } finally {
        controller.close();
      }
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
