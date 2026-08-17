"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { refreshAnalyticsAction } from "@/app/admin/analytics/actions";

export function AnalyticsRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="admin-secondary-button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        await refreshAnalyticsAction();
        router.refresh();
      })}
    >
      <RefreshCw size={17} className={pending ? "animate-spin" : ""} />
      {pending ? "Обновляем" : "Обновить"}
    </button>
  );
}
