export const socialProviders = ["telegram", "max"] as const;

export type SocialProvider = (typeof socialProviders)[number];

export type SocialIdentityClaims = {
  provider: SocialProvider;
  providerUserId: string;
  displayName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  telegramBotUserId?: string | null;
};

export function isSocialProvider(value: string): value is SocialProvider {
  return socialProviders.includes(value as SocialProvider);
}
