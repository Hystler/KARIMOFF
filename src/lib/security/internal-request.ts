import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyInternalBearer(request: Request, secret: string | undefined) {
  const expected = secret?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(authorization.slice(7).trim(), expected);
}
