import "server-only";

import { z, type ZodType } from "zod";

const API_BASE_URL = "https://api.evotor.ru/";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 100;

const pageSchema = z.object({
  items: z.array(z.unknown()).default([]),
  paging: z.object({ next_cursor: z.string().nullish() }).passthrough().nullish()
}).passthrough();

export class EvotorApiError extends Error {
  public readonly status: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    retryable: boolean
  ) {
    super(message);
    this.name = "EvotorApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

type ClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response | null, attempt: number) {
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 30_000);
  const reset = Number(response?.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset >= 0) return Math.min(Math.max(250, reset * 1000), 30_000);
  return Math.min(500 * 2 ** attempt, 5_000);
}

export class EvotorClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly token: string;

  constructor(token: string, options: ClientOptions = {}) {
    if (!token.trim()) throw new Error("Evotor access token is required.");
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async get<T>(path: string, schema: ZodType<T>, query: Record<string, string | number | undefined> = {}) {
    const url = new URL(path.replace(/^\//, ""), API_BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const payload = await this.request(url);
    return schema.parse(payload);
  }

  async list<T>(path: string, itemSchema: ZodType<T>, query: Record<string, string | number | undefined> = {}) {
    const items: T[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(path.replace(/^\//, ""), API_BASE_URL);
      const pageQuery = cursor ? { cursor } : query;
      for (const [key, value] of Object.entries(pageQuery)) {
        if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
      }
      const envelope = pageSchema.parse(await this.request(url));
      items.push(...envelope.items.map((item) => itemSchema.parse(item)));
      cursor = envelope.paging?.next_cursor ?? "";
      if (!cursor) return items;
    }
    throw new EvotorApiError("Evotor pagination limit exceeded.", 502, false);
  }

  private async request(url: URL) {
    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/vnd.evotor.v2+json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/vnd.evotor.v2+json"
          },
          cache: "no-store",
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (error) {
        if (attempt + 1 >= MAX_ATTEMPTS) {
          throw new EvotorApiError(error instanceof Error && error.name === "TimeoutError"
            ? "Evotor request timed out."
            : "Evotor API is unavailable.", 503, true);
        }
        await this.sleep(retryDelay(null, attempt));
        continue;
      }

      lastResponse = response;
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt + 1 >= MAX_ATTEMPTS) {
        const message = response.status === 401 || response.status === 403
          ? "Evotor rejected the application token."
          : response.status === 429
            ? "Evotor rate limit was exceeded."
            : `Evotor API returned HTTP ${response.status}.`;
        throw new EvotorApiError(message, response.status, retryable);
      }
      await this.sleep(retryDelay(response, attempt));
    }
    throw new EvotorApiError("Evotor API request failed.", lastResponse?.status ?? 503, true);
  }
}
