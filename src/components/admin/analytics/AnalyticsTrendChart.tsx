"use client";

import { useMemo, useState } from "react";
import { channelColors } from "@/lib/analytics/channels";
import { formatNumber, formatRub } from "@/lib/format";
import type { AnalyticsMetric, TimeSeriesPoint } from "@/lib/analytics/types";

const WIDTH = 960;
const HEIGHT = 300;
const PAD_X = 30;
const PAD_Y = 24;

function formatMetric(value: number, metric: AnalyticsMetric) {
  if (metric === "revenue" || metric === "average_check" || metric === "refunds") return formatRub(value, 1);
  return formatNumber(value, 1);
}

function chartY(value: number, min: number, max: number) {
  const height = HEIGHT - PAD_Y * 2;
  const span = Math.max(1, max - min);
  return PAD_Y + height - ((value - min) / span) * height;
}

function points(values: number[], min: number, max: number) {
  if (!values.length) return "";
  const width = WIDTH - PAD_X * 2;
  return values.map((value, index) => {
    const x = PAD_X + (index / Math.max(1, values.length - 1)) * width;
    const y = chartY(value, min, max);
    return `${x},${y}`;
  }).join(" ");
}

export function AnalyticsTrendChart({
  data,
  metric,
  breakdown
}: {
  data: TimeSeriesPoint[];
  metric: AnalyticsMetric;
  breakdown: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const series = useMemo(() => {
    const current = data.map((point) => point.value);
    const previous = data.map((point) => point.previousValue ?? 0);
    const channelNames = Array.from(new Set(data.flatMap((point) => Object.keys(point.channels ?? {}))));
    const channels = channelNames.map((channel) => ({
      id: channel,
      values: data.map((point) => point.channels?.[channel as keyof typeof point.channels] ?? 0)
    }));
    return { current, previous, channels };
  }, [data]);
  const allValues = [...series.current, ...series.previous, ...series.channels.flatMap((item) => item.values)];
  const minimum = Math.min(0, ...allValues);
  const maximum = Math.max(0, ...allValues);
  const baselineY = chartY(0, minimum, maximum);
  const activePoint = active === null ? null : data[active];

  if (!data.length || data.every((point) => point.value === 0 && !point.previousValue)) {
    return (
      <div className="analytics-chart-empty">
        <strong>В выбранном периоде пока нет продаж</strong>
        <span>Измените период или канал, чтобы увидеть динамику.</span>
      </div>
    );
  }

  return (
    <div className="analytics-chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="analytics-trend-chart"
        role="img"
        aria-label="График динамики продаж"
        onMouseLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="analytics-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FB670A" stopOpacity="0.24" />
            <stop offset="1" stopColor="#FB670A" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((line) => {
          const y = PAD_Y + ((HEIGHT - PAD_Y * 2) / 4) * line;
          return <line key={line} x1={PAD_X} x2={WIDTH - PAD_X} y1={y} y2={y} className="analytics-chart-grid" />;
        })}
        <line x1={PAD_X} x2={WIDTH - PAD_X} y1={baselineY} y2={baselineY} className="analytics-chart-zero" />
        {!breakdown ? (
          <>
            <polygon
              points={`${PAD_X},${baselineY} ${points(series.current, minimum, maximum)} ${WIDTH - PAD_X},${baselineY}`}
              fill="url(#analytics-area)"
            />
            <polyline points={points(series.previous, minimum, maximum)} className="analytics-chart-previous" />
            <polyline points={points(series.current, minimum, maximum)} className="analytics-chart-current" />
          </>
        ) : series.channels.map((item) => (
          <polyline
            key={item.id}
            points={points(item.values, minimum, maximum)}
            fill="none"
            stroke={channelColors[item.id as keyof typeof channelColors] ?? "#6D6B66"}
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {data.map((point, index) => {
          const x = PAD_X + (index / Math.max(1, data.length - 1)) * (WIDTH - PAD_X * 2);
          return (
            <rect
              key={point.key}
              x={x - Math.max(7, (WIDTH - PAD_X * 2) / Math.max(data.length, 1) / 2)}
              y="0"
              width={Math.max(14, (WIDTH - PAD_X * 2) / Math.max(data.length, 1))}
              height={HEIGHT}
              fill="transparent"
              tabIndex={0}
              aria-label={`${point.label}: ${formatMetric(point.value, metric)}`}
              onMouseEnter={() => setActive(index)}
              onPointerDown={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            />
          );
        })}
      </svg>
      <div className="analytics-chart-labels" aria-hidden="true">
        {data.filter((_, index) => index === 0 || index === data.length - 1 || index % Math.max(1, Math.ceil(data.length / 6)) === 0).map((point) => (
          <span key={point.key}>{point.label}</span>
        ))}
      </div>
      {activePoint ? (
        <div className="analytics-chart-tooltip" role="status">
          <strong>{activePoint.label}</strong>
          <span>Текущий: {formatMetric(activePoint.value, metric)}</span>
          {activePoint.previousValue !== null ? <span>Сравнение: {formatMetric(activePoint.previousValue, metric)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
