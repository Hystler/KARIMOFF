export const RESTAURANT_OPEN_HOUR = 11;
export const RESTAURANT_CLOSE_HOUR = 21;

export const OPERATING_HOURS = Array.from(
  { length: RESTAURANT_CLOSE_HOUR - RESTAURANT_OPEN_HOUR },
  (_, index) => RESTAURANT_OPEN_HOUR + index
);

export const OPERATING_INTERVALS = OPERATING_HOURS.map((hour) => ({
  hour,
  label: `${hour}–${hour + 1}`
}));

export function formatOperatingInterval(hour: number) {
  return `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`;
}
