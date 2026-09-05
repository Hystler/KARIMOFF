export type AnalyticsPalette = {
  accent: string;
  soft: string;
};

const palette: AnalyticsPalette[] = [
  { accent: "#C84E0A", soft: "#FFF0E8" },
  { accent: "#0F766E", soft: "#E7F6F3" },
  { accent: "#2563A8", soft: "#EAF2FB" },
  { accent: "#A33D5F", soft: "#FCEBF1" },
  { accent: "#9A6700", soft: "#FFF5D6" },
  { accent: "#6B5B95", soft: "#F1EEF8" }
];

const knownCategories: Array<[RegExp, number]> = [
  [/шаурм/i, 0],
  [/хот-?дог|френч/i, 1],
  [/бургер/i, 2],
  [/горяч|закуск|картоф|наггет|крыл|кревет/i, 3],
  [/соус/i, 4],
  [/добав/i, 5]
];

function stableIndex(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % palette.length;
}

export function getAnalyticsCategoryPalette(category: string) {
  const match = knownCategories.find(([pattern]) => pattern.test(category));
  return palette[match?.[1] ?? stableIndex(category)];
}
