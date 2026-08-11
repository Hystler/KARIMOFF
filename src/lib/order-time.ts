export const ORDER_TIME_ZONE = "Europe/Moscow";
export const ORDER_LEAD_MINUTES = 15;
export const ORDER_SLOT_MINUTES = 15;
const ORDER_SLOT_NETWORK_BUFFER_MINUTES = 1;

type MoscowParts = {
  dateKey: string;
  hour: number;
  minute: number;
  second: number;
};

const moscowFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORDER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function getMoscowParts(date: Date): MoscowParts {
  const parts = Object.fromEntries(
    moscowFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour ?? 0),
    minute: Number(parts.minute ?? 0),
    second: Number(parts.second ?? 0)
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getMoscowDateKey(date = new Date()) {
  return getMoscowParts(date).dateKey;
}

export function formatOrderSlot(totalMinutes: number) {
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

export function getSameDayOrderSlots(now = new Date()) {
  const current = getMoscowParts(now);
  const earliestDate = new Date(
    now.getTime() + (ORDER_LEAD_MINUTES + ORDER_SLOT_NETWORK_BUFFER_MINUTES) * 60_000
  );
  const earliest = getMoscowParts(earliestDate);

  if (earliest.dateKey !== current.dateKey) return [];

  const minuteWithSeconds = earliest.hour * 60 + earliest.minute + (earliest.second > 0 ? 1 : 0);
  const firstSlot = Math.ceil(minuteWithSeconds / ORDER_SLOT_MINUTES) * ORDER_SLOT_MINUTES;
  const lastSlot = 23 * 60 + 45;
  const slots: number[] = [];

  for (let minute = firstSlot; minute <= lastSlot; minute += ORDER_SLOT_MINUTES) {
    slots.push(minute);
  }

  return slots;
}

export function moscowOrderSlotToIso(dateKey: string, totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${dateKey}T${pad(hours)}:${pad(minutes)}:00+03:00`;
}

export function validateSameDayMoscowRequestedAt(value: string, now = new Date()) {
  const requestedAt = new Date(value);

  if (Number.isNaN(requestedAt.getTime())) {
    return { ok: false as const, message: "Выберите время получения заказа." };
  }

  if (getMoscowDateKey(requestedAt) !== getMoscowDateKey(now)) {
    return { ok: false as const, message: "Заказ ко времени можно оформить только на сегодня." };
  }

  if (requestedAt.getTime() < now.getTime() + ORDER_LEAD_MINUTES * 60_000) {
    return { ok: false as const, message: "Выберите время не раньше чем через 15 минут." };
  }

  return { ok: true as const, requestedAt };
}
