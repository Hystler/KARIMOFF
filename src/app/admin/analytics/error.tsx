"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="admin-content analytics-page">
      <div className="analytics-error-state">
        <CircleAlert size={28} />
        <h1>Не удалось загрузить аналитику</h1>
        <p>Данные не изменены. Проверьте подключение и повторите запрос.</p>
        <button type="button" className="admin-primary-button" onClick={reset}><RefreshCw size={17} />Повторить</button>
      </div>
    </main>
  );
}
