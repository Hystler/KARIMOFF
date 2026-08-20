import "server-only";

// Official Telegram JWKS snapshot. Public verification keys are safe to bundle;
// the live JWKS endpoint is still refreshed in the background when reachable.
export const TELEGRAM_JWKS_SNAPSHOT_UPDATED_AT = "2026-08-20";

export const TELEGRAM_RS256_JWKS_SNAPSHOT = [
  {
    alg: "RS256",
    e: "AQAB",
    ext: true,
    key_ops: ["verify"],
    kid: "oidc-1",
    kty: "RSA",
    n: "5RneLtsKvVcxdv6gu6gxEQu30Cru5NiMQnY6SNr9ZyZFZ4ya-pfHNuaZXJ6QPG0JSFwoxeOkEO2-eZN_REVPm448PvjjsR1eQdZ5QpEkNxnItFcmxkHH91v5cgf52_EI9BGO-MT6f1vaBSg3uWHFlDxI7J2AYxNvd1_Nf3TkgrrR7gyJFTmEIai5RefGnA0KGNYDlRIGUzrz2F05n6gTaHFT_iHL5UHatTZA4GCiUSjIOuwqu5pE5uZge20TFv3cxXMQaFw_xv1pgQt_Rq8eoCN7TS0RQ0zjWKiad-W286BcFectXsUm03p5Nq_kY4mf_7rqwX_B8yy_bBreyKn7RQ"
  }
] as const;
