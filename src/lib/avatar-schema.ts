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
    { value: "panda", label: "Панда" },
    { value: "panda_round", label: "Круглая панда" },
    { value: "panda_strict", label: "Строгая панда" }
  ],
  eyes: [
    { value: "default", label: "Классика" },
    { value: "happy", label: "Весёлые" },
    { value: "serious", label: "Серьёзные" },
    { value: "sleepy", label: "Сонные" }
  ],
  mouth: [
    { value: "smile", label: "Улыбка" },
    { value: "neutral", label: "Нейтрально" },
    { value: "grin", label: "Грин" }
  ],
  accessory: [
    { value: "none", label: "Без аксессуара" },
    { value: "orange_cap", label: "Оранжевая кепка" },
    { value: "black_cap", label: "Чёрная кепка" },
    { value: "sunglasses", label: "Очки" },
    { value: "burger_pin", label: "Пин-бургер" }
  ],
  clothes: [
    { value: "none", label: "Без одежды" },
    { value: "black_hoodie", label: "Чёрное худи" },
    { value: "orange_apron", label: "Оранжевый фартук" },
    { value: "black_apron", label: "Чёрный фартук" }
  ],
  background: [
    { value: "orange", label: "Оранжевый" },
    { value: "black", label: "Чёрный" },
    { value: "grill", label: "Гриль" },
    { value: "clean", label: "Чистый" },
    { value: "neon", label: "Неон" }
  ]
};

export const defaultAvatar: AvatarConfig = {
  base: "panda",
  eyes: "default",
  mouth: "smile",
  accessory: "none",
  clothes: "none",
  background: "orange"
};

