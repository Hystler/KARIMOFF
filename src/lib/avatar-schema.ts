import { z } from "zod";

export const avatarBaseSchema = z.enum(["panda"]);
export const avatarEyesSchema = z.enum(["default", "happy", "serious"]);
export const avatarMouthSchema = z.enum(["smile", "neutral"]);
export const avatarAccessorySchema = z.enum(["none", "cap_orange", "burger", "sunglasses"]);
export const avatarClothesSchema = z.enum(["none", "hoodie_black", "apron_orange"]);
export const avatarBackgroundSchema = z.enum(["orange", "black", "grill", "clean"]);

export const avatarSchema = z.object({
  base: avatarBaseSchema.default("panda"),
  eyes: avatarEyesSchema.default("default"),
  mouth: avatarMouthSchema.default("smile"),
  accessory: avatarAccessorySchema.default("none"),
  clothes: avatarClothesSchema.default("none"),
  background: avatarBackgroundSchema.default("orange")
});

export type AvatarConfig = z.infer<typeof avatarSchema>;

export const avatarOptions = {
  base: [{ value: "panda", label: "Панда" }],
  eyes: [
    { value: "default", label: "Классика" },
    { value: "happy", label: "Весёлые" },
    { value: "serious", label: "Серьёзные" }
  ],
  mouth: [
    { value: "smile", label: "Улыбка" },
    { value: "neutral", label: "Нейтрально" }
  ],
  accessory: [
    { value: "none", label: "Без аксессуара" },
    { value: "cap_orange", label: "Оранжевая кепка" },
    { value: "burger", label: "Бургер" },
    { value: "sunglasses", label: "Очки" }
  ],
  clothes: [
    { value: "none", label: "Без одежды" },
    { value: "hoodie_black", label: "Чёрное худи" },
    { value: "apron_orange", label: "Оранжевый фартук" }
  ],
  background: [
    { value: "orange", label: "Оранжевый" },
    { value: "black", label: "Чёрный" },
    { value: "grill", label: "Гриль" },
    { value: "clean", label: "Чистый" }
  ]
} as const;

export const defaultAvatar: AvatarConfig = {
  base: "panda",
  eyes: "default",
  mouth: "smile",
  accessory: "none",
  clothes: "none",
  background: "orange"
};
