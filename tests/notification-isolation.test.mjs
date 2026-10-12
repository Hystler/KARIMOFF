import assert from "node:assert/strict";
import test from "node:test";
import { notificationHarness } from "./helpers/notifications.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const start = "2026-09-01T00:00:00.000Z";
const fresh = "2026-09-02T00:00:00.000Z";
const old = "2026-08-31T23:59:59.999Z";
const telegramOnly = {
  TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED: "true",
  MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED: "false",
  TELEGRAM_ORDER_STATUS_NOTIFICATIONS_NOT_BEFORE: start,
  TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "live"
};
const row = (extra = {}) => ({
  id, order_id: id, provider: "telegram", provider_user_id: "login-sub",
  event_type: "ready", status: "pending", attempts: 0,
  created_at: fresh, order_created_at: fresh, sent_at: null, provider_message_id: null,
  ...extra
});
const send = (extra = {}) => ({
  provider: "telegram", recipientId: "123", event: "ready", orderNumber: "A-001",
  orderId: id, orderCreatedAt: fresh, deliveryCreatedAt: fresh, ...extra
});
const service = (h) => h.load("src/lib/notifications/order-status/service.ts");
const provider = (h) => h.load("src/lib/notifications/order-status/provider.ts");
const operations = (h) => h.load("src/lib/notifications/operations.ts");

// Interpret the actual parameterized SQL scope, not the TypeScript policy.
// This queue model checks that every mutation carries the channel/date/order gate.
function scopeAllows(statement, item) {
  const marker = "? and delivery.provider = 'telegram'";
  const offset = statement.query.indexOf(marker);
  assert.ok(offset >= 0, "queue mutation must include the authorization scope");
  assert.match(statement.query, /delivery\.created_at >= \?::timestamptz/);
  assert.match(statement.query, /scope_order\.created_at >= \?::timestamptz/);
  assert.match(statement.query, /\? or \(delivery\.order_id = \?::uuid and delivery\.event_type = 'ready'\)/);
  const position = (statement.query.slice(0, offset).match(/\?/g) ?? []).length;
  const [tg, tgStart, allOrders, canaryId, tgOrderStart, max, maxStart, maxOrderStart] = statement.parameters.slice(position);
  const after = (value, boundary) => boundary !== null && Date.parse(value) >= Date.parse(boundary);
  return item.provider === "telegram"
    ? tg && after(item.created_at, tgStart) && after(item.order_created_at, tgOrderStart)
      && (allOrders || (item.order_id === canaryId && item.event_type === "ready"))
    : max && after(item.created_at, maxStart) && after(item.order_created_at, maxOrderStart);
}

function queueHarness(items, env = {}, options = {}) {
  const rows = structuredClone(items);
  const requests = [];
  const subject = notificationHarness({ env: { ...telegramOnly, ...env },
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({ ok: true, result: { message_id: 42 } });
    },
    query: (statement) => {
      const { query, parameters } = statement;
      if (query.startsWith("with due")) {
        if (options.injectClaim) return [options.injectClaim];
        const due = rows.filter((r) => scopeAllows(statement, r)
          && ["pending", "retry"].includes(r.status) && r.attempts < 8
          && !r.sent_at && !r.provider_message_id);
        for (const r of due) { r.status = "processing"; r.attempts++; }
        return structuredClone(due);
      }
      if (query.startsWith("select order_row")) {
        const r = rows.find((r) => r.id === parameters[0]);
        if (!r || !scopeAllows(statement, r)) return [];
        options.beforeSend?.(subject);
        return [{ display_number: "A-001", kitchen_status: options.kitchenStatus ?? "ready", telegram_bot_user_id: "123",
          order_created_at: r.order_created_at, delivery_created_at: r.created_at }];
      }
      if (query.includes("set status = 'sent'")) {
        const r = rows.find((r) => r.id === parameters[1]);
        if (r?.status === "processing" && r.attempts === parameters[2]) {
          r.status = "sent"; r.sent_at = fresh; r.provider_message_id = parameters[0];
        }
      } else if (query.includes("set status = 'retry'")) {
        const r = rows.find((r) => r.id === parameters[0]);
        if (r && scopeAllows(statement, r) && r.status === "permanent_failure"
          && r.attempts === 1 && !r.sent_at && !r.provider_message_id
          && r.last_error_code === "telegram_not_configured") {
          r.status = "retry"; return [{ id: r.id }];
        }
      } else if (query.includes("delivery_outcome_unknown") || query.includes("attempts >= 8")) {
        for (const r of rows) {
          if (scopeAllows(statement, r) && (query.includes("attempts >= 8")
            ? ["pending", "retry"].includes(r.status) && r.attempts >= 8
            : r.status === "processing")) r.status = "permanent_failure";
        }
      }
      return [];
    }
  });
  return { subject, rows, requests };
}

test("both channel permissions default OFF, and master OFF prevents DB, HTTP and retry", async () => {
  for (const env of [
    { TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED: undefined, MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED: undefined },
    { TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED: "false", MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED: "false" },
    { ORDER_STATUS_NOTIFICATIONS_ENABLED: "false" }
  ]) {
    const { subject, requests } = queueHarness([row()], env);
    assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
    assert.equal(await operations(subject).retryNotificationDelivery(id, true), false);
    await assert.rejects(provider(subject).sendOrderStatusNotification(send()), (e) => e.code === "delivery_disabled");
    assert.equal(subject.connections, 0);
    assert.equal(requests.length, 0);
    subject.load("src/lib/notifications/order-status/scheduler.ts").startOrderNotificationScheduler();
    assert.equal(subject.timers.length, 0);
  }
});

test("Telegram ON/MAX OFF leaves MAX pending, exhausted and processing rows completely untouched", async () => {
  const maxRows = [row({ id: other, provider: "max" }),
    row({ id: "33333333-3333-4333-8333-333333333333", provider: "max", attempts: 8 }),
    row({ id: "44444444-4444-4444-8444-444444444444", provider: "max", status: "processing" })];
  const { subject, rows, requests } = queueHarness([row(), ...maxRows]);
  assert.equal((await service(subject).processOrderNotificationBatch()).sent, 1);
  assert.deepEqual(rows.slice(1), maxRows);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /api\.telegram\.org/);
  await assert.rejects(provider(subject).sendOrderStatusNotification(send({ provider: "max" })), (e) => e.code === "delivery_disabled");
});

test("MAX permission remains independent when Telegram is OFF", async () => {
  const requests = [];
  const subject = notificationHarness({ env: {
    TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED: "false",
    MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED: "true",
    TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: undefined
  }, fetch: async (url) => {
    requests.push(String(url));
    return Response.json({ message: { body: { mid: "accepted" } } });
  } });
  assert.equal(await provider(subject).sendOrderStatusNotification(send({ provider: "max" })), "accepted");
  await assert.rejects(provider(subject).sendOrderStatusNotification(send()), (e) => e.code === "delivery_disabled");
  assert.deepEqual(requests, ["https://platform-api2.max.ru/messages?user_id=123"]);
});

test("processing independently rejects injected MAX, old, non-canary and cancelled claims", async () => {
  for (const injected of [row({ provider: "max" }), row({ created_at: old }), row({ order_id: other }), row({ event_type: "cancelled" })]) {
    const { subject, requests } = queueHarness([], {
      TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "canary",
      TELEGRAM_ORDER_STATUS_NOTIFICATIONS_CANARY_ORDER_ID: id
    }, { injectClaim: injected });
    assert.equal((await service(subject).processOrderNotificationBatch()).skipped, 1);
    assert.equal(requests.length, 0);
    assert.equal(subject.calls.filter((s) => s.query.startsWith("select order_row")).length, 0);
  }
});

test("canary processes only its Telegram order; other orders and MAX remain untouched even if MAX is permitted", async () => {
  const others = [row({ id: other, order_id: other }),
    row({ id: "33333333-3333-4333-8333-333333333333", order_id: other, status: "processing" }),
    row({ id: "44444444-4444-4444-8444-444444444444", provider: "max" })];
  const { subject, rows, requests } = queueHarness([row(), ...others], {
    MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED: "true",
    TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "canary",
    TELEGRAM_ORDER_STATUS_NOTIFICATIONS_CANARY_ORDER_ID: id
  });
  assert.equal((await service(subject).processOrderNotificationBatch()).sent, 1);
  assert.deepEqual(rows.slice(1), others);
  assert.equal(requests.length, 1);
  await assert.rejects(provider(subject).sendOrderStatusNotification(send({ orderId: other })), (e) => e.code === "delivery_disabled");
});

test("canary ready → cancelled sends at most one notification, leaves cancellation untouched and blocks HTTP", async () => {
  const options = { kitchenStatus: "ready" };
  const { subject, rows, requests } = queueHarness([row()], {
    TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "canary",
    TELEGRAM_ORDER_STATUS_NOTIFICATIONS_CANARY_ORDER_ID: id
  }, options);
  assert.equal((await service(subject).processOrderNotificationBatch()).sent, 1);
  const accepted = structuredClone(rows[0]);
  const cancelled = row({ id: other, event_type: "cancelled" });
  rows.push(structuredClone(cancelled));
  options.kitchenStatus = "cancelled";
  for (let run = 0; run < 3; run++) {
    assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
  }
  assert.deepEqual(rows, [accepted, cancelled]);
  await assert.rejects(provider(subject).sendOrderStatusNotification(send({ event: "cancelled" })), (e) => e.code === "delivery_disabled");
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.text, /готов к выдаче/);
});

test("live still delivers cancelled events", async () => {
  const { subject, rows, requests } = queueHarness([row({ event_type: "cancelled" })], {}, { kitchenStatus: "cancelled" });
  assert.equal((await service(subject).processOrderNotificationBatch()).sent, 1);
  assert.equal(rows[0].status, "sent");
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.text, /отменён/);
});

test("missing/invalid canary ID, unknown mode and missing launch boundary fail closed", async () => {
  const cases = [
    ...[undefined, "", "bad", ` ${id}`, "00000000-0000-0000-0000-000000000000"].map((value) => ({
      TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "canary", TELEGRAM_ORDER_STATUS_NOTIFICATIONS_CANARY_ORDER_ID: value
    })),
    { TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: undefined },
    { TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "CANARY" },
    ...[undefined, "", "yesterday", "2026-02-31T00:00:00Z", "2999-01-01T00:00:00Z"].map((value) => ({
      TELEGRAM_ORDER_STATUS_NOTIFICATIONS_NOT_BEFORE: value
    }))
  ];
  for (const env of cases) {
    const { subject, rows, requests } = queueHarness([row()], env);
    assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
    assert.equal(await operations(subject).retryNotificationDelivery(id, true), false);
    await assert.rejects(provider(subject).sendOrderStatusNotification(send()), (e) => e.code === "delivery_disabled");
    assert.deepEqual(rows, [row()]);
    assert.equal(subject.connections, 0);
    assert.equal(requests.length, 0);
  }
});

test("old backlog and replayed events for old orders stay in history regardless of current ready status", async () => {
  const items = [row({ created_at: old }), row({ id: other, order_created_at: old }),
    row({ id: "33333333-3333-4333-8333-333333333333", created_at: old, status: "processing" })];
  const { subject, rows, requests } = queueHarness(items);
  assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
  assert.deepEqual(rows, items);
  assert.equal(requests.length, 0);
  for (const context of [{ deliveryCreatedAt: old }, { orderCreatedAt: old }, { orderCreatedAt: undefined }]) {
    await assert.rejects(provider(subject).sendOrderStatusNotification(send(context)), (e) => e.code === "delivery_disabled");
  }
});

test("sent deliveries are not replayed across repeated worker runs or master off/on", async () => {
  const { subject, rows, requests } = queueHarness([row()]);
  assert.equal((await service(subject).processOrderNotificationBatch()).sent, 1);
  const accepted = structuredClone(rows);
  assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
  subject.env.ORDER_STATUS_NOTIFICATIONS_ENABLED = "false";
  await service(subject).processOrderNotificationBatch();
  subject.env.ORDER_STATUS_NOTIFICATIONS_ENABLED = "true";
  assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
  assert.deepEqual(rows, accepted);
  assert.equal(requests.length, 1);
});

test("manual retry enforces channel, launch and canary scope and cannot revive excluded/sent rows", async () => {
  for (const extra of [{ provider: "max" }, { created_at: old }, { order_created_at: old },
    { order_id: other }, { event_type: "cancelled" }, { status: "superseded" }, { status: "sent", sent_at: fresh }]) {
    const item = row({ status: "permanent_failure", attempts: 1, last_error_code: "telegram_not_configured", ...extra });
    const { subject, rows, requests } = queueHarness([item], {
      TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "canary", TELEGRAM_ORDER_STATUS_NOTIFICATIONS_CANARY_ORDER_ID: id
    });
    assert.equal(await operations(subject).retryNotificationDelivery(id, true), false);
    assert.deepEqual(rows, [item]);
    assert.equal(subject.calls.filter((s) => s.query.includes("insert into public.audit_logs")).length, 0);
    assert.equal(requests.length, 0);
  }
  const { subject, requests } = queueHarness([row({ status: "permanent_failure", attempts: 1, last_error_code: "telegram_not_configured" })]);
  assert.equal(await operations(subject).retryNotificationDelivery(id, true), true);
  assert.equal(await operations(subject).retryNotificationDelivery(id, true), false);
  assert.equal(subject.calls.filter((s) => s.query.includes("insert into public.audit_logs")).length, 1);
  assert.equal(requests.length, 0);
});

test("provider rechecks permission changed after claim and order validation", async () => {
  const { subject, requests } = queueHarness([row()], {}, { beforeSend: (h) => {
    h.env.TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED = "false";
  } });
  await service(subject).processOrderNotificationBatch();
  assert.equal(requests.length, 0);
});
