import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { notificationHarness } from "./helpers/notifications.mjs";
import { renderToStaticMarkup } from "react-dom/server";

const root = process.cwd();
const id = "11111111-1111-4111-8111-111111111111";
const owner = { id, role: "owner", legacy: false };
const createdAt = "2026-09-01T00:00:00.000Z";
const delivery = { id, attempts: 1, provider: "max", provider_user_id: "123", event_type: "ready", order_id: id,
  created_at: createdAt, order_created_at: createdAt };
const relevantOrder = { display_number: "A-001", kitchen_status: "ready", telegram_bot_user_id: null,
  order_created_at: createdAt, delivery_created_at: createdAt };
const plain = (value) => JSON.parse(JSON.stringify(value));

const provider = (subject) => subject.load("src/lib/notifications/order-status/provider.ts");
const service = (subject) => subject.load("src/lib/notifications/order-status/service.ts");
const operations = (subject) => subject.load("src/lib/notifications/operations.ts");
const sendParams = { provider: "max", recipientId: "123", event: "ready", orderNumber: "A-001",
  orderId: id, orderCreatedAt: createdAt, deliveryCreatedAt: createdAt };
const providerError = (code, retryable) => (error) => error.code === code && error.retryable === retryable;

test("configuration exposes only booleans and validates HTTPS links without credentials", () => {
  const subject = notificationHarness();
  const configuration = subject.load("src/lib/notifications/order-status/configuration.ts");
  assert.deepEqual(plain(configuration.getNotificationConfiguration()), {
    enabled: true, maintenance: false, appOriginValid: true, telegramConfigured: true, maxConfigured: true,
    telegramEnabled: true, maxEnabled: true
  });
  for (const origin of ["", "invalid", "http://example.test", "https://user:secret@example.test", "javascript:alert(1)"]) {
    subject.env.APP_ORIGIN = origin;
    assert.equal(configuration.getOrderNotificationReturnUrl(), null);
  }
  subject.env.APP_ORIGIN = "https://example.test/ignored?session=secret#secret";
  assert.equal(configuration.getOrderNotificationReturnUrl(), "https://example.test/profile/orders");
});

test("official request and success envelopes retain message IDs and only the generic account link", async () => {
  const requests = [];
  const subject = notificationHarness({ fetch: async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(init.body) });
    return Response.json(String(url).includes("telegram") ? { ok: true, result: { message_id: 42 } } : { message: { body: { mid: "mid.42" } } });
  } });
  assert.equal(await provider(subject).sendOrderStatusNotification(sendParams), "mid.42");
  assert.equal(await provider(subject).sendOrderStatusNotification({ ...sendParams, provider: "telegram", event: "cancelled" }), "42");
  assert.equal(requests[0].url, "https://platform-api2.max.ru/messages?user_id=123");
  assert.equal(requests[0].init.headers.Authorization, "test-max-secret");
  assert.match(requests[1].url, /^https:\/\/api.telegram.org\/bot.*\/sendMessage$/);
  assert.equal(requests[1].body.chat_id, "123");
  assert.match(requests[0].body.text, /готов к выдаче/);
  assert.match(requests[1].body.text, /отменён/);
  for (const request of requests) {
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.cache, "no-store");
    assert.match(JSON.stringify(request.body), /https:\/\/example.test\/profile\/orders/);
    assert.doesNotMatch(JSON.stringify(request.body), /test-.*-secret|parse_mode|allow_paid_broadcast/);
  }
});

test("preflight gates prevent every HTTP request when disabled, in maintenance or misconfigured", async () => {
  for (const [env, code] of [
    [{ ORDER_STATUS_NOTIFICATIONS_ENABLED: "false" }, "delivery_disabled"],
    [{ ORDER_STATUS_NOTIFICATIONS_ENABLED: "TRUE" }, "delivery_disabled"],
    [{ MAINTENANCE_MODE: "true" }, "delivery_disabled"],
    [{ APP_ORIGIN: "invalid" }, "app_origin_not_configured"],
    [{ MAX_BOT_TOKEN: " " }, "max_not_configured"]
  ]) {
    let sent = 0;
    const subject = notificationHarness({ env, fetch: () => { sent++; throw new Error(); } });
    await assert.rejects(provider(subject).sendOrderStatusNotification(sendParams), providerError(code, false));
    assert.equal(sent, 0);
  }
});

test("ambiguous POST outcomes never become success or automatic retry", async () => {
  for (const channel of ["telegram", "max"]) {
    for (const fetch of [
      async () => { throw new Error("token-and-PII-must-not-escape"); },
      async () => new Response("not-json", { status: 200 }),
      async () => Response.json({ ok: true }),
      async () => Response.json({ body: { mid: "old-wrong-envelope" } }),
      async () => new Response(null, { status: 408 })
    ]) {
      const subject = notificationHarness({ fetch });
      await assert.rejects(provider(subject).sendOrderStatusNotification({ ...sendParams, provider: channel }), (error) => {
        assert.equal(error.message, `${channel}_outcome_unknown`);
        return error.retryable === false;
      });
    }
  }
});

test("provider rejections distinguish rate limits, temporary errors and permanent refusal", async () => {
  for (const channel of ["telegram", "max"]) {
    for (const [status, code, retryable] of [[403, "delivery_rejected", false], [500, "temporary_failure", true], [429, "rate_limited", true]]) {
      const subject = notificationHarness({ fetch: async () => Response.json({ ok: false, error_code: status }, { status }) });
      await assert.rejects(provider(subject).sendOrderStatusNotification({ ...sendParams, provider: channel }), providerError(`${channel}_${code}`, retryable));
    }
  }
  for (const [header, expected] of [[null, 30_000], ["120", 120_000], ["invalid", 30_000]]) {
    const subject = notificationHarness({ fetch: async () => new Response(null, { status: 429, headers: header ? { "retry-after": header } : {} }) });
    await assert.rejects(provider(subject).sendOrderStatusNotification(sendParams), (error) => error.retryAfterMs === expected);
  }
  const future = new Date(Date.now() + 120_000).toUTCString();
  const dated = notificationHarness({ fetch: async () => new Response(null, { status: 429, headers: { "retry-after": future } }) });
  await assert.rejects(provider(dated).sendOrderStatusNotification(sendParams), (error) => error.retryAfterMs > 115_000 && error.retryAfterMs <= 120_000);
  const telegram = notificationHarness({ fetch: async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 90 } }) });
  await assert.rejects(provider(telegram).sendOrderStatusNotification({ ...sendParams, provider: "telegram" }), (error) => error.code === "telegram_rate_limited" && error.retryAfterMs === 90_000);
});

test("disabled workers and invalid origin do not connect to the database", async () => {
  for (const env of [{ ORDER_STATUS_NOTIFICATIONS_ENABLED: "false" }, { MAINTENANCE_MODE: "true" }, { APP_ORIGIN: "" }]) {
    const subject = notificationHarness({ env });
    assert.equal((await service(subject).processOrderNotificationBatch()).claimed, 0);
    assert.equal(subject.connections, 0);
  }
});

test("expired and legacy ambiguous deliveries are quarantined; claims exclude exhausted and accepted records", async () => {
  const subject = notificationHarness();
  assert.equal((await service(subject).processOrderNotificationBatch(Number.NaN)).claimed, 0);
  assert.equal(subject.calls.length, 3);
  assert.match(subject.calls[0].query, /delivery_outcome_unknown/);
  assert.match(subject.calls[0].query, /telegram_network_failure/);
  assert.match(subject.calls[1].query, /attempts >= 8/);
  assert.match(subject.calls[2].query, /status in \('pending', 'retry'\) and delivery.attempts < 8/);
  assert.match(subject.calls[2].query, /sent_at is null and delivery.provider_message_id is null/);
  assert.match(subject.calls[2].query, /for update skip locked/);
  assert.equal(subject.calls[2].parameters.at(-1), 10);
});

function workerHarness({ claimed = delivery, order = relevantOrder, fetch, failSent = false } = {}) {
  return notificationHarness({ fetch, query: ({ query }) => {
    if (query.startsWith("with due")) return [claimed];
    if (query.startsWith("select order_row")) return order ? [order] : [];
    if (failSent && query.includes("set status = 'sent'")) throw new Error("database-secret");
    return [];
  } });
}

test("an accepted POST followed by a DB failure is never requeued by the catch block", async () => {
  let sends = 0;
  const subject = workerHarness({ failSent: true, fetch: async () => { sends++; return Response.json({ message: { body: { mid: "accepted" } } }); } });
  const result = await service(subject).processOrderNotificationBatch();
  assert.equal(sends, 1);
  assert.equal(result.failed, 1);
  assert.equal(subject.calls.filter(({ query }) => query.includes("available_at = case")).length, 0);
  const sent = subject.calls.find(({ query }) => query.includes("set status = 'sent'"));
  assert.match(sent.query, /attempts = \?/);
  assert.match(sent.query, /delivery_outcome_unknown/);
  assert.doesNotMatch(JSON.stringify(subject.logs), /database-secret|test-max-secret/);
});

test("obsolete, test, unlinked or reassigned orders cannot reach the provider", async () => {
  for (const order of [null, { ...relevantOrder, kitchen_status: "handed_out" }, { ...relevantOrder, kitchen_status: "cancelled" }]) {
    let sends = 0;
    const subject = workerHarness({ order, fetch: async () => { sends++; throw new Error(); } });
    assert.equal((await service(subject).processOrderNotificationBatch()).superseded, 1);
    assert.equal(sends, 0);
    const select = subject.calls.find(({ query }) => query.startsWith("select order_row")).query;
    assert.match(select, /identity_row.user_id = delivery.customer_id/);
    assert.match(select, /identity_row.user_id = order_row.customer_id/);
    assert.match(select, /order_row.is_test = false/);
    assert.match(select, /delivery.attempts = \?/);
    assert.match(select, /delivery.locked_at >= now\(\) - interval '5 minutes'/);
  }
});

test("Telegram recipient fails closed without a positive safe signed profile ID; no sub fallback", async () => {
  for (const value of [null, undefined, "", "0", "-123", "123x", "1.5", "1e3", "00123", " 123", "9007199254740992", 123]) {
    let sends = 0;
    const subject = workerHarness({
      claimed: { ...delivery, provider: "telegram", provider_user_id: "777777" },
      order: { ...relevantOrder, telegram_bot_user_id: value },
      fetch: () => { sends++; throw new Error(); }
    });
    assert.equal((await service(subject).processOrderNotificationBatch()).failed, 1);
    assert.equal(sends, 0);
    assert.ok(subject.calls.at(-1).parameters.includes("telegram_recipient_unverified"));
  }
});

test("Telegram uses signed metadata.telegramBotUserId after normal login, never OIDC sub", async () => {
  for (const value of ["123456", "9007199254740991"]) {
    const recipients = [];
    const subject = workerHarness({
      claimed: { ...delivery, provider: "telegram", provider_user_id: "777777" },
      order: { ...relevantOrder, telegram_bot_user_id: value },
      fetch: async (_url, init) => { recipients.push(JSON.parse(init.body).chat_id); return Response.json({ ok: true, result: { message_id: 42 } }); }
    });
    assert.equal((await service(subject).processOrderNotificationBatch()).sent, 1);
    assert.deepEqual(recipients, [value]);
    assert.match(subject.calls.find(({ query }) => query.startsWith("select order_row")).query, /metadata->>'telegramBotUserId'/);
  }
});

test("retry backoff honors provider delay and stops at eight attempts", async () => {
  for (const attempt of [1, 8]) {
    const subject = workerHarness({ claimed: { ...delivery, attempts: attempt }, fetch: async () => new Response(null, { status: 429, headers: { "retry-after": "120" } }) });
    const result = await service(subject).processOrderNotificationBatch();
    assert.equal(result[attempt === 8 ? "failed" : "retry"], 1);
    const failed = subject.calls.at(-1);
    assert.equal(failed.parameters[0], attempt === 8 ? "permanent_failure" : "retry");
    assert.equal(failed.parameters[2], attempt === 8 ? 3600 : 120);
    assert.match(failed.query, /status = 'processing' and attempts = \?/);
  }
});

test("scheduler catches failures, releases its running flag and never logs raw exceptions", async () => {
  let batches = 0;
  const subject = notificationHarness({ mocks: {
    "./service": {
      areOrderStatusNotificationsEnabled: () => true,
      processOrderNotificationBatch: async () => { batches++; throw new Error("private-db-url"); }
    }
  } });
  const scheduler = subject.load("src/lib/notifications/order-status/scheduler.ts");
  scheduler.startOrderNotificationScheduler();
  scheduler.startOrderNotificationScheduler();
  assert.equal(subject.timers.length, 2);
  subject.timers[0]();
  await new Promise(setImmediate);
  subject.timers[0]();
  await new Promise(setImmediate);
  assert.equal(batches, 2);
  assert.equal(subject.logs.filter(([event]) => event === "order_notification.batch_failed").length, 2);
  assert.doesNotMatch(JSON.stringify(subject.logs), /private-db-url/);
});

test("read, retry and server action reject unauthenticated and non-global staff before DB access", async () => {
  for (const staff of [null, { role: "manager", id }, { role: "cashier", id }, { role: "cook", id }]) {
    const subject = notificationHarness({ staff });
    const api = operations(subject);
    const expected = staff ? "/admin" : "/admin/login";
    for (const invoke of [
      () => api.getNotificationWorkspace(),
      () => api.retryNotificationDelivery(id, true),
      () => subject.load("src/app/admin/notifications/actions.ts").retryNotificationAction(new FormData())
    ]) await assert.rejects(invoke(), (error) => error.path === expected);
    assert.equal(subject.connections, 0);
  }
});

test("health reads are bounded, read-only, secret-free and distinguish unavailable from empty", async () => {
  for (const staff of [owner, { role: "admin", id: null, legacy: true }]) {
    const subject = notificationHarness({ staff, query: ({ query }) => query.includes("group by") ? [] : [{
      ...delivery, status: "permanent_failure", last_error_code: "raw-token-phone@example.test", can_retry: false
    }] });
    const snapshot = await operations(subject).getNotificationWorkspace(true);
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.deliveries[0].errorLabel, "Требуется проверка");
    assert.doesNotMatch(JSON.stringify(snapshot), /raw-token|test-max-secret|test-telegram-secret/);
    assert.ok(subject.calls.every(({ query }) => query.startsWith("select")));
    assert.match(subject.calls[1].query, /limit 50$/);
    assert.equal(subject.calls[1].parameters.at(-1), false);
  }
  for (const [code, expected] of [["42P01", "schema_missing"], ["42703", "schema_missing"], ["ECONNREFUSED", "unavailable"]]) {
    const subject = notificationHarness({ query: () => { throw Object.assign(new Error("secret"), { code }); } });
    const snapshot = await operations(subject).getNotificationWorkspace();
    assert.equal(snapshot.error, expected);
    assert.equal(snapshot.checkedAt, null);
    assert.doesNotMatch(JSON.stringify(subject.logs), /secret/);
  }
});

test("shared notification preflight reads both queues and blocks on either channel backlog", () => {
  const preflight = readFileSync(resolve(root, "scripts/telegram-order-notifications-preflight.mjs"), "utf8");
  assert.match(preflight, /QUEUE_PROVIDERS = \["telegram", "max"\]/);
  assert.match(preflight, /group by provider, status/);
  assert.match(preflight, /queue\.pending \+ queue\.retry \+ queue\.processing === 0 && queue\.staleLocks === 0/);
  assert.match(preflight, /database\.available && maxTokenConfigured/);
  assert.doesNotMatch(preflight, /where provider = 'telegram'/);
});

test("manual retry is confirmed, single-row, conditional, audited and never directly sends", async () => {
  const subject = notificationHarness({ query: ({ query }) => query.startsWith("update") ? [{ id }] : [] });
  assert.equal(await operations(subject).retryNotificationDelivery(id, true), true);
  assert.equal(subject.transactions, 1);
  assert.equal(subject.calls.length, 2);
  const update = subject.calls[0];
  assert.match(update.query, /where delivery.id = \?::uuid/);
  assert.equal(update.parameters[0], id);
  assert.match(update.query, /status = 'permanent_failure' and delivery.attempts = 1/);
  assert.match(update.query, /sent_at is null and delivery.provider_message_id is null/);
  assert.match(update.query, /locked_at is null and delivery.available_at <= now\(\)/);
  assert.match(update.query, /app_origin_not_configured.*telegram_not_configured.*max_not_configured/);
  assert.match(update.query, /telegram_recipient_unverified/);
  assert.match(update.query, /case when coalesce\(identity_row.metadata->>'telegramBotUserId'/);
  assert.match(update.query, /::numeric <= 9007199254740991 else false end/);
  assert.match(update.query, /order_row.kitchen_status = delivery.event_type/);
  assert.doesNotMatch(update.query, /set .*attempts = 0|outcome_unknown|delivery_rejected/);
  assert.match(subject.calls[1].query, /insert into public.audit_logs/);
  const loser = notificationHarness();
  assert.equal(await operations(loser).retryNotificationDelivery(id, true), false);
  assert.equal(loser.calls.length, 1, "a duplicate/stale click does not audit or enqueue again");
});

test("manual retry cannot bypass kill switches, invalid input or confirmation", async () => {
  for (const [env, deliveryId, confirmed] of [
    [{}, id, false], [{}, "not-a-uuid", true],
    [{ ORDER_STATUS_NOTIFICATIONS_ENABLED: "false" }, id, true],
    [{ MAINTENANCE_MODE: "true" }, id, true], [{ APP_ORIGIN: "invalid" }, id, true]
  ]) {
    const subject = notificationHarness({ env });
    assert.equal(await operations(subject).retryNotificationDelivery(deliveryId, confirmed), false);
    assert.equal(subject.connections, 0);
  }
});

test("admin page renders empty, missing-schema and disabled states without campaigns or fake health", async () => {
  for (const failure of [false, true]) {
    const subject = notificationHarness({ env: { ORDER_STATUS_NOTIFICATIONS_ENABLED: "false" }, query: () => {
      if (failure) throw Object.assign(new Error("secret-token"), { code: "42P01" });
      return [];
    } });
    const page = subject.load("src/app/admin/notifications/page.tsx");
    const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ result: "arbitrary-untrusted-error" }) }));
    assert.match(html, /Уведомления/);
    assert.match(html, /Выключена/);
    assert.match(html, /Не активированы/);
    assert.doesNotMatch(html, /test-.*-secret|secret-token|arbitrary-untrusted-error|name="delivery_id"/);
    assert.match(html, failure ? /Схема очереди недоступна/ : /Очередь пока пуста/);
  }
});
