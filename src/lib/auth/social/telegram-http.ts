import { request as requestHttp, type RequestOptions } from "node:http";
import { request as requestHttps } from "node:https";

const MAX_RESPONSE_BYTES = 128 * 1024;

export class TelegramHttpError extends Error {
  readonly code: string;

  constructor(code: TelegramHttpError["code"], options?: { cause?: unknown }) {
    super(code, options);
    this.name = "TelegramHttpError";
    this.code = code;
  }
}

export function getSafeNetworkErrorCode(error: unknown) {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  const value = candidate?.cause?.code ?? candidate?.code;
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null;
}

async function requestJson(params: {
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
}) {
  const target = new URL(params.url);
  const request = target.protocol === "https:" ? requestHttps : requestHttp;
  return new Promise<{ ok: boolean; payload: unknown; status: number }>((resolve, reject) => {
    let completed = false;
    let phase = "request";
    let timer: NodeJS.Timeout | null = null;

    const finish = (callback: () => void) => {
      if (completed) return;
      completed = true;
      if (timer) clearTimeout(timer);
      callback();
    };

    const options: RequestOptions = {
      family: 4,
      headers: params.headers,
      method: "GET"
    };

    const outgoing = request(target, options, (response) => {
      phase = "response";
      const chunks: Buffer[] = [];
      let receivedBytes = 0;

      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new TelegramHttpError("RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(buffer);
      });
      response.once("error", (error) => finish(() => reject(error)));
      response.once("end", () => {
        finish(() => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let payload: unknown = rawBody;
          try {
            payload = JSON.parse(rawBody);
          } catch {
            // Let the protocol layer classify a non-JSON response with its HTTP status.
          }
          const status = response.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, payload, status });
        });
      });
    });

    outgoing.once("socket", (socket) => {
      phase = "socket";
      socket.once("lookup", (error) => {
        phase = error ? "dns_error" : "dns";
      });
      socket.once("connect", () => {
        phase = "tcp";
      });
      socket.once("secureConnect", () => {
        phase = "tls";
      });
    });
    outgoing.once("error", (error) => finish(() => reject(error)));
    timer = setTimeout(() => {
      const timeout = new TelegramHttpError(`REQUEST_TIMEOUT_${phase.toUpperCase()}`);
      outgoing.destroy(timeout);
    }, params.timeoutMs);
    outgoing.end();
  });
}

export function getJson(params: {
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
}) {
  return requestJson(params);
}
