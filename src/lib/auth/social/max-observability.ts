import "server-only";

export type MaxAuthEvent =
  | "max.browser.consume"
  | "max.challenge.completed"
  | "max.contact.received"
  | "max.contact.requested"
  | "max.failed"
  | "max.identity.resolved"
  | "max.login.started"
  | "max.miniapp.loaded"
  | "max.redirect.success"
  | "max.session.created"
  | "max.session.readback"
  | "max.contact.valid"
  | "max.webappdata.received"
  | "max.webappdata.valid";

type MaxAuthEventDetails = {
  correlationId: string;
  stage: string;
  errorCode?: string;
  authDateFormat?: "seconds" | "milliseconds" | "invalid";
  contactHashFormat?: "base64" | "hex64" | "invalid";
  bridgePlatform?: "android" | "desktop" | "ios" | "web" | "unknown";
  bridgeVersion?: string;
  phonePresent?: boolean;
  requestContactAvailable?: boolean;
  resolution?: "authenticated" | "existing" | "linked" | "link" | "needs_phone" | "new";
};

export function logMaxAuthEvent(event: MaxAuthEvent, details: MaxAuthEventDetails) {
  console.info(JSON.stringify({
    event,
    provider: "max",
    correlation_id: details.correlationId,
    stage: details.stage,
    timestamp: new Date().toISOString(),
    ...(details.errorCode ? { error_code: details.errorCode } : {}),
    ...(details.authDateFormat ? { auth_date_format: details.authDateFormat } : {}),
    ...(details.contactHashFormat ? { contact_hash_format: details.contactHashFormat } : {}),
    ...(details.bridgePlatform ? { bridge_platform: details.bridgePlatform } : {}),
    ...(details.bridgeVersion ? { bridge_version: details.bridgeVersion } : {}),
    ...(typeof details.phonePresent === "boolean" ? { phone_present: details.phonePresent } : {}),
    ...(typeof details.requestContactAvailable === "boolean" ? { request_contact_available: details.requestContactAvailable } : {}),
    ...(details.resolution ? { resolution: details.resolution } : {})
  }));
}
