"use client";

import { Expand, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

export function AnalyticsFullscreenButton({ targetId }: { targetId: string }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onChange = () => setExpanded(document.fullscreenElement?.id === targetId);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [targetId]);

  return (
    <button
      type="button"
      className="analytics-icon-button"
      aria-label={expanded ? "Закрыть полноэкранный режим" : "Открыть на весь экран"}
      title={expanded ? "Закрыть полноэкранный режим" : "На весь экран"}
      onClick={async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.getElementById(targetId)?.requestFullscreen();
      }}
    >
      {expanded ? <Minimize2 size={16} /> : <Expand size={16} />}
    </button>
  );
}
