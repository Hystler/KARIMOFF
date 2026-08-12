"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function AnalyticsRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="admin-secondary-button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw size={17} className={pending ? "animate-spin" : ""} />
      {pending ? "Обновляем" : "Обновить"}
    </button>
  );
}
