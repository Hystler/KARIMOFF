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

export function canUnlinkAuthenticationMethod(identityCount: number, hasPasswordFallback: boolean) {
  return identityCount + (hasPasswordFallback ? 1 : 0) > 1;
}
