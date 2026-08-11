import "server-only";

const EVOTOR_API_BASE_URL = "https://api.evotor.ru";
const MAX_PAGES = 50;

type UnknownRecord = Record<string, unknown>;

export type EvotorSaleItem = {
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
};

export type EvotorSaleDocument = {
  id: string;
  number: number | null;
  close_date: string;
  device_id: string | null;
  store_id: string;
  total: number;
  items: EvotorSaleItem[];
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function getEvotorStatus() {
  const enabled = process.env.EVOTOR_ENABLED === "true";
  const configured = Boolean(process.env.EVOTOR_API_TOKEN && process.env.EVOTOR_STORE_ID);

  return { enabled, configured, ready: enabled && configured };
}

function normalizePosition(value: unknown, index: number): EvotorSaleItem {
  const position = asRecord(value);
  const quantity = Math.max(0, asNumber(position.quantity));
  const unitPrice = asNumber(position.result_price ?? position.price);
  const total = asNumber(position.result_sum) || unitPrice * quantity;
  const fallbackName = String(position.code ?? position.product_id ?? `Позиция ${index + 1}`);

  return {
    product_id: position.product_id ? String(position.product_id) : null,
    name: String(position.name ?? position.product_name ?? fallbackName).slice(0, 180),
    quantity,
    unit_price: unitPrice,
    total
  };
}

function normalizeDocument(value: unknown, storeId: string): EvotorSaleDocument | null {
  const document = asRecord(value);
  if (document.type !== "SELL" || !document.id || !document.close_date) return null;

  const body = asRecord(document.body);
  const positions = Array.isArray(body.positions) ? body.positions : [];
  const items = positions.map(normalizePosition).filter((item) => item.quantity > 0);
  const positionsTotal = items.reduce((sum, item) => sum + item.total, 0);

  return {
    id: String(document.id),
    number: Number.isFinite(Number(document.number)) ? Number(document.number) : null,
    close_date: String(document.close_date),
    device_id: document.device_id ? String(document.device_id) : null,
    store_id: String(document.store_id ?? storeId),
    total: asNumber(body.result_sum ?? body.sum) || positionsTotal,
    items
  };
}

export async function fetchEvotorSales(params: { since: Date; until: Date }) {
  const status = getEvotorStatus();
  if (!status.ready) {
    throw new Error("Интеграция с Эвотором не настроена.");
  }

  const token = process.env.EVOTOR_API_TOKEN ?? "";
  const storeId = process.env.EVOTOR_STORE_ID ?? "";
  const documents: EvotorSaleDocument[] = [];
  let cursor = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`/stores/${encodeURIComponent(storeId)}/documents`, EVOTOR_API_BASE_URL);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    } else {
      url.searchParams.set("since", String(params.since.getTime()));
      url.searchParams.set("until", String(params.until.getTime()));
      url.searchParams.set("type", "SELL");
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.evotor.v2+json",
        Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        "Content-Type": "application/vnd.evotor.v2+json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      throw new Error(`Эвотор вернул ошибку ${response.status}. Проверьте токен и магазин.`);
    }

    const payload = asRecord(await response.json());
    const items = Array.isArray(payload.items) ? payload.items : [];
    documents.push(
      ...items
        .map((item) => normalizeDocument(item, storeId))
        .filter((item): item is EvotorSaleDocument => Boolean(item))
    );

    cursor = String(asRecord(payload.paging).next_cursor ?? "");
    if (!cursor) break;
  }

  return documents;
}
