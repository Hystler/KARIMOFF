import { avatarAssetTypes, defaultAvatar, type AvatarConfig } from "@/lib/avatar-schema";

export type AvatarPreset = { id: string; name: string; avatar: AvatarConfig };

function preset(id: string, name: string, overrides: Partial<AvatarConfig>): AvatarPreset {
  return { id, name, avatar: { ...defaultAvatar, ...overrides } };
}

// Ready-made looks reuse the existing 2D panda artwork and the persisted six-part format.
export const avatarPresets: AvatarPreset[] = [
  preset("classic", "Классик", {}),
  preset("chef", "Шеф", { clothes: "chef_jacket", eyes: "happy", background: "clean" }),
  preset("music", "Меломан", { accessory: "headphones", clothes: "black_hoodie", background: "clean" }),
  preset("sunny", "Солнечный", { accessory: "orange_cap", eyes: "happy", clothes: "black_hoodie" }),
  preset("calm", "Спокойный", { base: "panda_rookie", eyes: "sleepy", mouth: "neutral", clothes: "black_hoodie", background: "clean" }),
  preset("confident", "Уверенный", { base: "panda_titan", eyes: "focused", mouth: "smirk", clothes: "utility_black", background: "clean" }),
  preset("smile", "Улыбка", { base: "panda_rookie", eyes: "happy", mouth: "grin", clothes: "chef_jacket" }),
  preset("night", "Ночной", { accessory: "sunglasses", mouth: "smirk", clothes: "black_hoodie", background: "night_city" }),
  preset("crew", "В команде", { base: "panda_titan", accessory: "orange_cap", clothes: "utility_black", background: "clean" }),
  preset("chill", "На чиле", { base: "panda_rookie", eyes: "sleepy", accessory: "headphones", mouth: "smile", background: "night_city" })
];

export function isSameAvatar(first: AvatarConfig, second: AvatarConfig): boolean {
  return avatarAssetTypes.every((key) => first[key] === second[key]);
}
