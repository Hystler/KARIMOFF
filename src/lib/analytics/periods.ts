import type {
  AnalyticsComparison,
  AnalyticsGranularity,
  AnalyticsPeriodKey,
  AnalyticsRange
} from "./types";
import { formatOperatingInterval, OPERATING_HOURS } from "./operating-hours";

export const DEFAULT_ANALYTICS_TIMEZONE = "Europe/Moscow";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  formatterCache.set(timezone, created);
  return created;
}

export function getZonedParts(date: Date, timezone = DEFAULT_ANALYTICS_TIMEZONE): ZonedParts {
  const parts = Object.fromEntries(
    formatter(timezone).formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function dateKeyFromParts(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getDateKey(date: Date, timezone = DEFAULT_ANALYTICS_TIMEZONE) {
  return dateKeyFromParts(getZonedParts(date, timezone));
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid analytics date.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addCalendarDays(dateKey: string, days: number) {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addCalendarMonths(dateKey: string, months: number) {
  const { year, month, day } = parseDateKey(dateKey);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(first.getUTCDate())}`;
}

export function zonedDateTimeToUtc(
  parts: ZonedParts,
  timezone = DEFAULT_ANALYTICS_TIMEZONE
) {
  const intended = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  let guess = intended;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedParts(new Date(guess), timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const corrected = guess + (intended - represented);
    if (corrected === guess) break;
    guess = corrected;
  }
  return new Date(guess);
}

export function startOfZonedDay(dateKey: string, timezone = DEFAULT_ANALYTICS_TIMEZONE) {
  const date = parseDateKey(dateKey);
  return zonedDateTimeToUtc({ ...date, hour: 0, minute: 0, second: 0 }, timezone);
}

function weekday(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function monthStart(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function quarterStart(dateKey: string) {
  const { year, month } = parseDateKey(dateKey);
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${pad(quarterMonth)}-01`;
}

function countCalendarDays(from: string, toExclusive: string) {
  const left = parseDateKey(from);
  const right = parseDateKey(toExclusive);
  return Math.round(
    (Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) /
      86_400_000
  );
}

export function countAnalyticsCalendarDays(range: AnalyticsRange, weekdays: number[] = []) {
  let count = 0;
  for (
    let key = range.fromDateKey;
    key < range.toDateKeyExclusive;
    key = addCalendarDays(key, 1)
  ) {
    if (!weekdays.length || weekdays.includes(weekday(key))) count += 1;
  }
  return count;
}

export function averagePerAnalyticsDay(
  total: number,
  range: AnalyticsRange,
  weekdays: number[] = []
) {
  const days = countAnalyticsCalendarDays(range, weekdays);
  return days > 0 ? total / days : 0;
}

function formatRangeLabel(from: string, toExclusive: string) {
  const to = addCalendarDays(toExclusive, -1);
  const date = (key: string) =>
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${key}T12:00:00Z`))
      .replace(" г.", "");
  return from === to ? date(from) : `${date(from)} — ${date(to)}`;
}

export function getAnalyticsRange(params: {
  period: AnalyticsPeriodKey;
  dateFrom?: string | null;
  dateTo?: string | null;
  now?: Date;
  timezone?: string;
}): AnalyticsRange {
  const timezone = params.timezone ?? DEFAULT_ANALYTICS_TIMEZONE;
  const today = getDateKey(params.now ?? new Date(), timezone);
  let from = today;
  let toExclusive = addCalendarDays(today, 1);

  switch (params.period) {
    case "yesterday":
      from = addCalendarDays(today, -1);
      toExclusive = today;
      break;
    case "7d":
      from = addCalendarDays(today, -6);
      break;
    case "30d":
      from = addCalendarDays(today, -29);
      break;
    case "this_week":
      from = addCalendarDays(today, 1 - weekday(today));
      break;
    case "last_week": {
      const thisWeek = addCalendarDays(today, 1 - weekday(today));
      from = addCalendarDays(thisWeek, -7);
      toExclusive = thisWeek;
      break;
    }
    case "this_month":
      from = monthStart(today);
      break;
    case "last_month": {
      const currentMonth = monthStart(today);
      from = addCalendarMonths(currentMonth, -1);
      toExclusive = currentMonth;
      break;
    }
    case "this_quarter":
      from = quarterStart(today);
      break;
    case "last_quarter": {
      const currentQuarter = quarterStart(today);
      from = addCalendarMonths(currentQuarter, -3);
      toExclusive = currentQuarter;
      break;
    }
    case "custom":
      if (params.dateFrom && params.dateTo && params.dateFrom <= params.dateTo) {
        from = params.dateFrom;
        toExclusive = addCalendarDays(params.dateTo, 1);
      }
      break;
    default:
      break;
  }

  return {
    from: startOfZonedDay(from, timezone),
    to: startOfZonedDay(toExclusive, timezone),
    fromDateKey: from,
    toDateKeyExclusive: toExclusive,
    label: formatRangeLabel(from, toExclusive),
    period: params.period,
    timezone
  };
}

function rangeFromDateKeys(range: AnalyticsRange, from: string, toExclusive: string, label: string) {
  return {
    ...range,
    from: startOfZonedDay(from, range.timezone),
    to: startOfZonedDay(toExclusive, range.timezone),
    fromDateKey: from,
    toDateKeyExclusive: toExclusive,
    label
  };
}

export function getComparisonRange(range: AnalyticsRange, comparison: AnalyticsComparison) {
  if (comparison === "previous_week") {
    return rangeFromDateKeys(
      range,
      addCalendarDays(range.fromDateKey, -7),
      addCalendarDays(range.toDateKeyExclusive, -7),
      "Предыдущая неделя"
    );
  }
  if (comparison === "previous_month") {
    return rangeFromDateKeys(
      range,
      addCalendarMonths(range.fromDateKey, -1),
      addCalendarMonths(range.toDateKeyExclusive, -1),
      "Предыдущий месяц"
    );
  }
  if (comparison === "previous_year") {
    return rangeFromDateKeys(
      range,
      addCalendarMonths(range.fromDateKey, -12),
      addCalendarMonths(range.toDateKeyExclusive, -12),
      "Предыдущий год"
    );
  }
  const days = Math.max(1, countCalendarDays(range.fromDateKey, range.toDateKeyExclusive));
  return rangeFromDateKeys(
    range,
    addCalendarDays(range.fromDateKey, -days),
    range.fromDateKey,
    "Предыдущий аналогичный период"
  );
}

export function getAnalyticsGranularity(range: AnalyticsRange): AnalyticsGranularity {
  const days = countCalendarDays(range.fromDateKey, range.toDateKeyExclusive);
  if (days <= 1) return "hour";
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}

export function buildBucketKeys(range: AnalyticsRange, granularity: AnalyticsGranularity) {
  const keys: string[] = [];
  if (granularity === "hour") {
    const start = getZonedParts(range.from, range.timezone);
    for (const hour of OPERATING_HOURS) {
      keys.push(`${dateKeyFromParts(start)}T${pad(hour)}`);
    }
    return keys;
  }
  if (granularity === "day") {
    for (let key = range.fromDateKey; key < range.toDateKeyExclusive; key = addCalendarDays(key, 1)) {
      keys.push(key);
    }
    return keys;
  }
  if (granularity === "week") {
    let key = addCalendarDays(range.fromDateKey, 1 - weekday(range.fromDateKey));
    while (key < range.toDateKeyExclusive) {
      keys.push(key);
      key = addCalendarDays(key, 7);
    }
    return keys;
  }
  let key = monthStart(range.fromDateKey);
  while (key < range.toDateKeyExclusive) {
    keys.push(key);
    key = addCalendarMonths(key, 1);
  }
  return keys;
}

export function formatBucketLabel(key: string, granularity: AnalyticsGranularity) {
  if (granularity === "hour") return formatOperatingInterval(Number(key.slice(-2)));
  const date = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("ru-RU", {
    day: granularity === "month" ? undefined : "numeric",
    month: "short",
    year: granularity === "month" ? "2-digit" : undefined,
    timeZone: "UTC"
  }).format(date);
}
