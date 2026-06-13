"use client";

import { useCart } from "./CartProvider";

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function CartDrawer() {
  const { clearCart, closeCart, decrement, increment, isOpen, lines, removeItem, totalPrice, checkout } = useCart();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="Закрыть корзину"
        className="absolute inset-0 bg-karimoff-black/24 backdrop-blur-[2px]"
        onClick={closeCart}
      />
      <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-md flex-col bg-white shadow-2xl sm:rounded-l-[2rem]">
        <div className="flex items-center justify-between border-b border-karimoff-line p-5">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Корзина</p>
            <h2 className="mt-1 text-3xl font-black text-karimoff-black">Ваш заказ</h2>
          </div>
          <button
            type="button"
            onClick={closeCart}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-karimoff-line text-xl leading-none transition hover:border-karimoff-orange hover:text-karimoff-orange"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-karimoff-line bg-karimoff-cream p-6 text-sm leading-6 text-karimoff-muted">
              Корзина пока пустая. Добавьте бургер из меню, и он появится здесь.
            </div>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => (
                <article key={line.product.id} className="rounded-lg border border-karimoff-line bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-karimoff-black">{line.product.name}</h3>
                      <p className="mt-1 text-sm font-bold text-karimoff-orange">{formatPrice(line.product.price)} ₽</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(line.product.id)}
                      className="text-sm font-semibold text-karimoff-muted transition hover:text-red-600"
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div className="inline-flex items-center rounded-full border border-karimoff-line">
                      <button
                        type="button"
                        onClick={() => decrement(line.product.id)}
                        className="h-9 w-10 text-lg font-bold transition hover:text-karimoff-orange"
                        aria-label="Уменьшить количество"
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-sm font-bold">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => increment(line.product.id)}
                        className="h-9 w-10 text-lg font-bold transition hover:text-karimoff-orange"
                        aria-label="Увеличить количество"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-base font-black text-karimoff-black">
                      {formatPrice(line.quantity * line.product.price)} ₽
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-karimoff-line p-5">
          <div className="mb-4 flex items-center justify-between text-lg font-black">
            <span>Итого</span>
            <span className="text-karimoff-orange">{formatPrice(totalPrice)} ₽</span>
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={checkout}
              disabled={!lines.length}
              className="rounded-full bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-karimoff-black disabled:cursor-not-allowed disabled:opacity-55"
            >
              Оформить заявку
            </button>
            {lines.length ? (
              <button
                type="button"
                onClick={clearCart}
                className="rounded-full border border-karimoff-line px-6 py-3 text-sm font-semibold transition hover:border-karimoff-orange hover:text-karimoff-orange"
              >
                Очистить корзину
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
