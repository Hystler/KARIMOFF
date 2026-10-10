import assert from "node:assert/strict";
import test from "node:test";
import { MaxCanaryError, normalizeMaxRecipientId, validateCanaryInvocation } from "../scripts/max-notification-canary.mjs";

const config = {
  MAX_NOTIFICATION_TEST_RECIPIENT_ID: "123456789",
  MAX_NOTIFICATION_TEST_SEND_ENABLED: "true"
};

test("MAX canary is limited to one explicit recipient and requires a separate send gate", () => {
  assert.deepEqual(validateCanaryInvocation(config, ["--preflight-only"]), {
    mode: "preflight", recipientId: "123456789"
  });
  assert.deepEqual(validateCanaryInvocation(config, ["--confirm-recipient=123456789"]), {
    mode: "send", recipientId: "123456789"
  });
  assert.equal(normalizeMaxRecipientId("9223372036854775807"), "9223372036854775807");
  assert.equal(normalizeMaxRecipientId("9223372036854775808"), null);
  assert.equal(normalizeMaxRecipientId("001234"), null);
  assert.throws(() => validateCanaryInvocation(config, ["--confirm-recipient=987654321"]), (error) => {
    assert.ok(error instanceof MaxCanaryError);
    assert.equal(error.code, "recipient_confirmation_mismatch");
    return true;
  });
  assert.throws(() => validateCanaryInvocation({ ...config, MAX_NOTIFICATION_TEST_SEND_ENABLED: "false" }, ["--confirm-recipient=123456789"]), /test_send_disabled/);
  assert.throws(() => validateCanaryInvocation({ ...config, ORDER_STATUS_NOTIFICATIONS_ENABLED: "true" }, ["--preflight-only"]), /notification_worker_must_be_disabled/);
});
