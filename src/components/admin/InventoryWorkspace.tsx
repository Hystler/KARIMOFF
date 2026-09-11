"use client";

import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, History, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { OperationsSubmitButton } from "./OperationsSubmitButton";
import styles from "./OperationsWorkspace.module.css";

type InventoryRow = {
  id: string;
  name: string;
  category: string | null;
  location: string | null;
  hasItem: boolean;
  quantity: string;
  minimum: string;
  cost: string;
  stockValue: string;
  status: "normal" | "low" | "empty" | "missing" | "deficit";
};

type Action = (formData: FormData) => void | Promise<void>;
type Operation = "receipt" | "write-off" | "correction";
const operations = [
  { id: "receipt", label: "Приход", submit: "Добавить приход", icon: ArrowDownToLine },
  { id: "write-off", label: "Списание", submit: "Списать", icon: ArrowUpFromLine },
  { id: "correction", label: "Корректировка", submit: "Сохранить остаток", icon: SlidersHorizontal }
] as const;
const statusLabels = { normal: "Норм", low: "Низкий остаток", empty: "Нет остатка", missing: "Нет карточки", deficit: "Дефицит" };
const writeOffReasons = ["Порча", "Истёк срок годности", "Брак", "Тестовая готовка", "Инвентаризация", "Другое"];

export function InventoryWorkspace({ cards, receiptAction, writeOffAction, correctionAction, createAction }: {
  cards: InventoryRow[];
  receiptAction: Action;
  writeOffAction: Action;
  correctionAction: Action;
  createAction: Action;
}) {
  const [operation, setOperation] = useState<Operation>("receipt");
  const disclosure = useRef<HTMLDetailsElement>(null);
  const availableCards = cards.filter((card) => card.hasItem);
  const actions = { receipt: receiptAction, "write-off": writeOffAction, correction: correctionAction };

  function openOperation(next: Operation, id: string) {
    setOperation(next);
    if (disclosure.current) disclosure.current.open = true;
    const ingredientSelect = disclosure.current?.querySelector<HTMLSelectElement>(`#${next} select[name="ingredient_id"]`);
    if (ingredientSelect) ingredientSelect.value = id;
    requestAnimationFrame(() => {
      disclosure.current?.querySelector<HTMLInputElement>(`#${next} input[type="number"]`)?.focus();
    });
  }

  return (
    <>
      <details ref={disclosure} className={`${styles.disclosure} ${styles.section} group`}>
        <summary><SlidersHorizontal size={16} />Складская операция<ChevronDown size={16} className="ml-auto transition-transform group-open:rotate-180" /></summary>
        <div className={styles.disclosureBody}>
          <div className={styles.modeSwitch} role="group" aria-label="Тип складской операции">
            {operations.map((item) => <button key={item.id} type="button" aria-pressed={operation === item.id} aria-controls={item.id} onClick={() => setOperation(item.id)}>{item.label}</button>)}
          </div>
          {operations.map((item) => (
            <form key={item.id} id={item.id} action={actions[item.id]} hidden={operation !== item.id}>
              <div className={styles.formGrid}>
                <label className={`${styles.field} ${styles.spanTwo}`}>
                  Ингредиент
                  <select name="ingredient_id" required defaultValue="">
                    <option value="">Выберите ингредиент</option>
                    {availableCards.map((card) => <option key={card.id} value={card.id}>{card.name} ({card.quantity})</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  {item.id === "correction" ? "Новый остаток" : "Количество"}
                  <input name={item.id === "correction" ? "new_quantity" : "quantity"} required type="number" min="0" step="0.001" />
                </label>
                {item.id === "receipt" ? <label className={styles.field}>Сумма закупки, ₽<input name="package_price" type="number" min="0" step="0.01" /></label> : null}
                {item.id === "write-off" ? <label className={styles.field}>Причина<select name="reason">{writeOffReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label> : null}
                <label className={`${styles.field} ${styles.spanTwo}`}>Комментарий<textarea name="comment" rows={1} /></label>
                {item.id === "receipt" ? <label className={`${styles.check} ${styles.spanTwo}`}><input name="update_cost_per_unit" type="checkbox" />Обновить себестоимость по закупке</label> : null}
              </div>
              <div className={styles.formFooter}>
                <OperationsSubmitButton disabled={!availableCards.length}><item.icon size={15} />{item.submit}</OperationsSubmitButton>
                {!availableCards.length ? <p className={styles.muted}>Сначала создайте складскую карточку ингредиента.</p> : null}
              </div>
            </form>
          ))}
        </div>
      </details>
      <section className={styles.section} aria-labelledby="inventory-stock-heading">
        <div className={styles.sectionHeading}><h2 id="inventory-stock-heading">Остатки ингредиентов</h2><span className={styles.muted}>{cards.length} позиций</span></div>
        {cards.length ? (
          <div className={styles.tableScroll} role="region" aria-label="Остатки ингредиентов" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Ингредиент / категория</th><th scope="col" className={styles.numeric}>Остаток</th><th scope="col" className={styles.numeric} title="Заказать, когда остаток равен порогу или ниже">Порог закупки</th><th scope="col">Статус</th><th scope="col" className={styles.numeric}>Себестоимость</th><th scope="col" className={styles.numeric}>Стоимость остатка</th><th scope="col">Действия</th></tr></thead>
              <tbody>{cards.map((card) => (
                <tr key={card.id}>
                  <td><strong>{card.name}</strong><span className={styles.subline}>{card.category ?? "Без категории"} · {card.location ?? "Локация не задана"}</span></td>
                  <td className={styles.numeric}><strong className={card.status === "deficit" ? styles.negative : undefined}>{card.quantity}</strong></td>
                  <td className={styles.numeric}>{card.minimum}</td>
                  <td><span className={styles.status} data-tone={card.status}>{statusLabels[card.status]}</span></td>
                  <td className={styles.numeric}>{card.cost}</td>
                  <td className={styles.numeric}><strong>{card.stockValue}</strong></td>
                  <td><div className={styles.actions}>
                    {card.hasItem ? operations.map(({ id, label, icon: Icon }) => (
                      <button key={id} type="button" className={styles.iconButton} title={label} aria-label={`${label}: ${card.name}`} onClick={() => openOperation(id, card.id)}><Icon size={15} /></button>
                    )) : (
                      <form action={createAction}>
                        <input type="hidden" name="ingredient_id" value={card.id} />
                        <input type="hidden" name="return_to" value="/admin/inventory" />
                        <OperationsSubmitButton className={styles.button}><Plus size={14} />Создать карточку</OperationsSubmitButton>
                      </form>
                    )}
                    <Link href={`/admin/inventory/movements?ingredient_id=${card.id}`} className={styles.iconButton} title="История" aria-label={`История: ${card.name}`}><History size={15} /></Link>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>Ингредиентов пока нет.</p>}
      </section>
    </>
  );
}
