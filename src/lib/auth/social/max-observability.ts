import "server-only";

export type MaxAuthEvent =
  | "max.challenge.completed"
  | "max.challenge.created"
  | "max.failed"
  | "max.identity.resolved"
  | "max.session.created"
  | "max.session.readback"
  | "max.webapp.contact.valid"
  | "max.webapp.data.valid";

type MaxAuthEventDetails = {
  correlationId: string;
  stage: string;
  errorCode?: string;
  phonePresent?: boolean;
  resolution?: "authenticated" | "linked" | "needs_phone";
};

export function logMaxAuthEvent(event: MaxAuthEvent, details: MaxAuthEventDetails) {
  console.info(JSON.stringify({
    event,
    provider: "max",
    correlation_id: details.correlationId,
    stage: details.stage,
    timestamp: new Date().toISOString(),
    ...(details.errorCode ? { error_code: details.errorCode } : {}),
    ...(typeof details.phonePresent === "boolean" ? { phone_present: details.phonePresent } : {}),
    ...(details.resolution ? { resolution: details.resolution } : {})
  }));
}
