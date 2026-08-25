export function resolveSocialLoginTarget(params: {
  existingIdentityUserId: string | null;
  providerPhoneVerified: boolean;
  verifiedPhoneUserId: string | null;
}) {
  if (params.existingIdentityUserId) {
    return { kind: "existing_identity" as const, userId: params.existingIdentityUserId };
  }
  if (params.providerPhoneVerified && params.verifiedPhoneUserId) {
    return { kind: "verified_phone" as const, userId: params.verifiedPhoneUserId };
  }
  return { kind: "needs_phone_confirmation" as const, userId: null };
}

export function resolveVerifiedSocialIdentity(params: {
  existingIdentityUserId: string | null;
  providerPhone: string | null;
  providerPhoneVerified: boolean;
  phoneOwner: { userId: string; verified: boolean } | null;
}) {
  if (params.existingIdentityUserId) {
    return { kind: "existing_identity" as const, userId: params.existingIdentityUserId };
  }
  if (!params.providerPhone || !params.providerPhoneVerified) {
    return { kind: "needs_phone_confirmation" as const, userId: null };
  }
  if (params.phoneOwner) {
    // A provider-verified phone proves ownership and safely upgrades legacy
    // customer rows created before phone_verified_at was tracked.
    return { kind: "verified_phone" as const, userId: params.phoneOwner.userId };
  }
  return { kind: "create_customer" as const, userId: null };
}

export function canUnlinkAuthenticationMethod(identityCount: number, hasPasswordFallback: boolean) {
  return identityCount + (hasPasswordFallback ? 1 : 0) > 1;
}
