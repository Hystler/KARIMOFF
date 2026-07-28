import { z } from "zod";

export const avatarAssetTypes = ["base", "eyes", "mouth", "accessory", "clothes", "background"] as const;
export type AvatarAssetType = (typeof avatarAssetTypes)[number];

export type AvatarOption = {
  image_url?: string | null;
  label: string;
  value: string;
};

export type AvatarOptions = Record<AvatarAssetType, AvatarOption[]>;

export const avatarSchema = z.object({
  base: z.string().trim().min(1).default("panda"),
  eyes: z.string().trim().min(1).default("default"),
  mouth: z.string().trim().min(1).default("smile"),
  accessory: z.string().trim().min(1).default("none"),
  clothes: z.string().trim().min(1).default("none"),
  background: z.string().trim().min(1).default("orange")
});

export type AvatarConfig = z.infer<typeof avatarSchema>;

export const avatarOptions: AvatarOptions = {
  base: [
    { value: "panda_core", label: "Классик" },
    { value: "panda_rookie", label: "Руки" },
    { value: "panda_titan", label: "Титан" }
  ],
  eyes: [
    { value: "bright", label: "Живые" },
    { value: "happy", label: "Улыбчивые" },
    { value: "focused", label: "Собранные" },
    { value: "sleepy", label: "Спокойные" }
  ],
  mouth: [
    { value: "smile", label: "Улыбка" },
    { value: "smirk", label: "Ухмылка" },
    { value: "grin", label: "Широкая улыбка" },
    { value: "neutral", label: "Спокойно" }
  ],
  accessory: [
    { value: "none", label: "Без аксессуара" },
    { value: "orange_cap", label: "Оранжевая кепка" },
    { value: "headphones", label: "Наушники" },
    { value: "sunglasses", label: "Тёмные очки" },
    { value: "orange_visor", label: "Оранжевый визор" }
  ],
  clothes: [
    { value: "varsity_orange", label: "Куртка KARIMOFF" },
    { value: "black_hoodie", label: "Графитовое худи" },
    { value: "chef_jacket", label: "Китель шефа" },
    { value: "utility_black", label: "Чёрный utility" }
  ],
  background: [
    { value: "studio_orange", label: "Orange studio" },
    { value: "night_city", label: "Ночной город" },
    { value: "kitchen_line", label: "Открытая кухня" },
    { value: "clean", label: "Светлая студия" }
  ]
};

export const defaultAvatar: AvatarConfig = {
  base: "panda_core",
  eyes: "bright",
  mouth: "smile",
  accessory: "none",
  clothes: "varsity_orange",
  background: "studio_orange"
};
