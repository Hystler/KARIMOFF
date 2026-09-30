export type DeliveryHours = {
  timezone: string;
  acceptanceStart: string;
  acceptanceEnd: string;
};

export const DEFAULT_DELIVERY_HOURS: DeliveryHours = {
  timezone: "Europe/Moscow",
  acceptanceStart: "11:00",
  acceptanceEnd: "20:30"
};

function minuteOfDay(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid delivery hours configuration.");
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getDeliveryAcceptanceState(now: Date, hours = DEFAULT_DELIVERY_HOURS) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: hours.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const localMinute = Number(parts.find((part) => part.type === "hour")?.value) * 60
    + Number(parts.find((part) => part.type === "minute")?.value);

  const start = minuteOfDay(hours.acceptanceStart);
  const end = minuteOfDay(hours.acceptanceEnd);

  if (localMinute < start) return "before";
  if (localMinute > end) return "after";
  return "open";
}

export function isDeliveryAcceptingAt(now: Date, hours = DEFAULT_DELIVERY_HOURS) {
  return getDeliveryAcceptanceState(now, hours) === "open";
}
