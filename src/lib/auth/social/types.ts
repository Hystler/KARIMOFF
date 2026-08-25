export const socialProviders = ["telegram", "max"] as const;

export type SocialProvider = (typeof socialProviders)[number];

export type SocialIdentityClaims = {
  provider: SocialProvider;
  providerUserId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  metadata: Record<string, string | number | boolean | null>;
};

export function isSocialProvider(value: string): value is SocialProvider {
  return socialProviders.includes(value as SocialProvider);
}
