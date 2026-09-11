import { History, LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InventoryWorkspace } from "@/components/admin/InventoryWorkspace";
import styles from "@/components/admin/OperationsWorkspace.module.css";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { formatRub } from "@/lib/format";
import { formatInventoryQuantity, getInventoryCards } from "@/lib/inventory";
import { logoutAction } from "../login/actions";
import {
  correctInventoryAction,
  createInventoryItemAction,
  receiptInventoryAction,
  writeOffInventoryAction
} from "./actions";

type AdminInventoryPageProps = {
  searchParams?: Promise<{ error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage({ searchParams }: AdminInventoryPageProps) {
  if (!await isAdminAuthenticated()) redirect("/admin/login");

  const params = searchParams ? await searchParams : {};
  const { cards, movementsToday, notConfigured, error } = await getInventoryCards();
  const inventoryCount = cards.filter((card) => card.item).length;
  const lowCount = cards.filter((card) => card.status === "low" || card.status === "empty").length;
  const stockValue = cards.reduce((sum, card) => sum + card.stock_value, 0);

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div><Link href="/admin">Админка</Link><h1>Склад</h1></div>
        <div className={styles.actions}>
          <Link href="/admin/inventory/movements" className={styles.button}><History size={15} />Движения</Link>
          <form action={logoutAction}><button type="submit" className={styles.iconButton} aria-label="Выйти" title="Выйти"><LogOut size={15} /></button></form>
        </div>
      </header>
      {params.saved ? <div role="status" className={styles.notice} data-tone="success">Склад обновлён.</div> : null}
      {params.error ? <div role="alert" className={styles.notice} data-tone="error">Ошибка: {params.error}</div> : null}
      {notConfigured ? (
        <div className={styles.notice} data-tone="warning">База данных не подключена. Заполните переменные окружения.</div>
      ) : error ? (
        <div role="alert" className={styles.notice} data-tone="error">{error}</div>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Сводка склада">
            <div><span>Ингредиентов на складе</span><strong>{inventoryCount}</strong></div>
            <div><span>Низкие остатки / дефицит</span><strong className={lowCount ? styles.warning : undefined}>{lowCount}</strong></div>
            <div><span>Стоимость остатков</span><strong>{formatRub(stockValue, 2)}</strong></div>
            <div><span>Движений сегодня</span><strong>{movementsToday}</strong></div>
          </section>
          <InventoryWorkspace
            cards={cards.map((card) => ({
              id: card.ingredient.id,
              name: card.ingredient.name,
              category: card.ingredient.category,
              location: card.item?.location ?? null,
              hasItem: Boolean(card.item),
              quantity: card.item ? formatInventoryQuantity(card.item.current_quantity, card.item.unit) : "—",
              minimum: card.item ? formatInventoryQuantity(card.item.min_quantity, card.item.unit) : "—",
              cost: `${formatRub(card.ingredient.cost_per_unit, 4)} / ${card.ingredient.unit}`,
              stockValue: formatRub(card.stock_value, 2),
              status: card.item && card.item.current_quantity < 0 ? "deficit" : card.status
            }))}
            receiptAction={receiptInventoryAction}
            writeOffAction={writeOffInventoryAction}
            correctionAction={correctInventoryAction}
            createAction={createInventoryItemAction}
          />
        </>
      )}
    </main>
  );
}
