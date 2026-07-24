import "server-only";

export async function sendVerificationCode(phone: string, code?: string): Promise<{ ok: boolean }> {
  const provider = process.env.VERIFICATION_PROVIDER;
  const apiKey = process.env.SMS_API_KEY;
  const sender = process.env.SMS_SENDER;

  if (process.env.NODE_ENV !== "production") {
    console.info(`[KARIMOFF verification] ${phone}: ${code ?? "code generated"}`);
    return { ok: true };
  }

  if (!provider || !apiKey || !sender) {
    return { ok: false };
  }

  // No real provider adapter is implemented in this MVP. Production must fail
  // closed even if placeholders were accidentally filled.
  return { ok: false };
}
