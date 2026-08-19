import { z } from "zod";

class TelegramProtocolError extends Error {
  readonly stage = "token_exchange" as const;
  readonly code: "token_rejected" | "token_response_invalid";
  readonly httpStatus: number | null;
  readonly providerError: string | null;

  constructor(
    code: TelegramProtocolError["code"],
    httpStatus: number | null,
    providerError: string | null = null
  ) {
    super(code);
    this.name = "TelegramProtocolError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerError = providerError;
  }
}

const telegramTokenSchema = z.object({
  id_token: z.string().min(20),
  token_type: z.string().optional(),
  expires_in: z.number().optional()
});

const telegramOAuthErrorSchema = z.object({
  error: z.string().min(1).max(128),
  error_description: z.string().max(512).optional()
});

export type TelegramTokenResponse = z.infer<typeof telegramTokenSchema>;

export function normalizeTelegramPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `+7${digits}`;
  return null;
}

export function parseTelegramTokenResponse(params: {
  payload: unknown;
  ok: boolean;
  status: number;
}): TelegramTokenResponse {
  const oauthError = telegramOAuthErrorSchema.safeParse(params.payload);
  if (oauthError.success) {
    throw new TelegramProtocolError("token_rejected", params.status, oauthError.data.error);
  }
  if (!params.ok) {
    throw new TelegramProtocolError("token_rejected", params.status);
  }
  const token = telegramTokenSchema.safeParse(params.payload);
  if (!token.success) {
    throw new TelegramProtocolError("token_response_invalid", params.status);
  }
  return token.data;
}
