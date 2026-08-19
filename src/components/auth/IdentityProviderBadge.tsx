import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";

type IdentityProviderBadgeProps = {
  provider: "phone" | "telegram" | "vk";
  username?: string | null;
  phoneVerified?: boolean;
};

const labels = {
  phone: "Телефон",
  telegram: "Telegram",
  vk: "VK ID"
} as const;

export function IdentityProviderBadge({ provider, username, phoneVerified = false }: IdentityProviderBadgeProps) {
  return (
    <span
      className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border border-karimoff-line bg-white px-2.5 py-1 text-xs font-bold text-karimoff-black"
      title={`${labels[provider]}${phoneVerified ? ", телефон подтверждён" : ""}`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${provider === "telegram" ? "bg-[#229ED9]" : provider === "vk" ? "bg-[#0077FF]" : "bg-karimoff-black"}`}>
        <SocialProviderIcon provider={provider} className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{provider === "telegram" && username ? `@${username}` : labels[provider]}</span>
    </span>
  );
}
