import type { AnalyticsChannel } from "./types";

export const channelLabels: Record<AnalyticsChannel, string> = {
  pos_evotor: "Касса",
  web: "Сайт",
  mobile: "Приложение",
  aggregator: "Агрегаторы"
};

export const channelColors: Record<AnalyticsChannel, string> = {
  pos_evotor: "#FB670A",
  web: "#17171A",
  mobile: "#2979FF",
  aggregator: "#6D6B66"
};

export function getChannelLabel(channel: string) {
  return channelLabels[channel as AnalyticsChannel] ?? "Другой канал";
}
