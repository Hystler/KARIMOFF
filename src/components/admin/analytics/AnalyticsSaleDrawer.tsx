"use client";

import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { getChannelLabel } from "@/lib/analytics/channels";
import { getPaymentMethodLabel, getSaleStatusLabel } from "@/lib/analytics/metrics";
import type { AnalyticsSaleDetail } from "@/lib/analytics/types";
import { formatNumber, formatRub } from "@/lib/format";

export function AnalyticsSaleDrawer({ detail, closeHref }: { detail: AnalyticsSaleDetail; closeHref: string }) {
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        router.replace(closeHref, { scroll: false });
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [closeHref, router]);

  const sale = detail.sale;
  return (
    <div className="analytics-drawer-layer" role="dialog" aria-modal="true" aria-labelledby="sale-title">
      <Link href={closeHref} className="analytics-drawer-backdrop" aria-label="Закрыть карточку продажи" scroll={false} />
      <aside className="analytics-sale-drawer" ref={drawerRef}>
        <header>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="analytics-source-badge">{getChannelLabel(sale.channel)}</span>
              <span className={`analytics-sale-status analytics-sale-status-${sale.status}`}>{getSaleStatusLabel(sale.status)}</span>
            </div>
            <h2 id="sale-title">{sale.channel === "pos_evotor" ? "Чек" : "Заказ"} {sale.number}</h2>
            <p>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(sale.analyticsAt))}</p>
          </div>
          <Link ref={closeRef} href={closeHref} className="analytics-drawer-close" aria-label="Закрыть" scroll={false}><X size={21} /></Link>
        </header>

        <div className="analytics-drawer-total">
          <span>Итого после возвратов</span>
          <strong>{formatRub(sale.netRevenue, 2)}</strong>
        </div>

        <section>
          <h3>Позиции</h3>
          <div className="analytics-drawer-list">
            {detail.items.map((item) => (
              <div key={item.id}>
                <div className="min-w-0">
                  <strong>{item.name}</strong>
                  <span>{formatNumber(item.quantity, 2)} × {formatRub(item.unitPrice, 2)}</span>
                  {item.mappingStatus === "unmapped" ? <em>Не сопоставлено</em> : null}
                </div>
                <strong>{formatRub(item.total, 2)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3>Оплата</h3>
          <dl className="analytics-drawer-facts">
            {detail.payments.length ? detail.payments.map((payment) => (
              <div key={payment.id}>
                <dt>{getPaymentMethodLabel(payment.method)}</dt>
                <dd>{formatRub(payment.amount, 2)}</dd>
              </div>
            )) : <div><dt>Способ оплаты</dt><dd>Не определён</dd></div>}
            <div><dt>До скидки</dt><dd>{formatRub(sale.grossAmount, 2)}</dd></div>
            <div><dt>Скидка</dt><dd>{formatRub(sale.discountAmount, 2)}</dd></div>
            <div><dt>Возврат</dt><dd>{formatRub(sale.refundAmount, 2)}</dd></div>
          </dl>
        </section>

        <section>
          <h3>Источник</h3>
          <dl className="analytics-drawer-facts">
            <div><dt>Канал</dt><dd>{getChannelLabel(sale.channel)}</dd></div>
            <div><dt>Провайдер</dt><dd>{sale.paymentProvider === "yookassa" ? "YooKassa" : sale.paymentProvider === "evotor" ? "Evotor" : sale.paymentProvider}</dd></div>
            <div><dt>Точка</dt><dd>{sale.location}</dd></div>
            <div><dt>Касса</dt><dd>{sale.terminal ?? "Не указана"}</dd></div>
            <div><dt>{sale.channel === "web" ? "Клиент" : "Сотрудник"}</dt><dd>{sale.customer ?? sale.employee ?? "Не определён"}</dd></div>
          </dl>
        </section>

        <details className="analytics-technical-details">
          <summary>Технические данные <ChevronDown size={17} /></summary>
          <dl>
            <div><dt>Внутренний ID</dt><dd>{sale.saleId}</dd></div>
            <div><dt>Внешний ID</dt><dd>{detail.technical.externalSourceId}</dd></div>
            <div><dt>Источник записи</dt><dd>{detail.technical.sourceRecordId}</dd></div>
            <div><dt>Синхронизировано</dt><dd>{detail.technical.sourceUpdatedAt ? new Date(detail.technical.sourceUpdatedAt).toLocaleString("ru-RU") : "—"}</dd></div>
          </dl>
        </details>
      </aside>
    </div>
  );
}
