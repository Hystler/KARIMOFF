"use client";

import { useRouter } from "next/navigation";
import type { CustomerOrderItem } from "@/lib/customer-orders";

type RepeatOrderButtonProps = {
  items: CustomerOrderItem[];
  orderId: string;
};

export function RepeatOrderButton({ items, orderId }: RepeatOrderButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        const lines = items.map((item) => ({
          product: {
            id: item.product_id ?? `repeat-${orderId}-${item.id}`,
            name: item.product_name,
            slug: item.product_id ?? item.id,
            price: item.unit_price,
            image_url: null
          },
          quantity: item.quantity
        }));

        window.localStorage.setItem("karimoff_cart", JSON.stringify(lines));
        router.push("/?checkout=1");
      }}
      className="public-button-primary min-h-10 px-4 py-2.5 text-xs"
    >
      Повторить заказ
    </button>
  );
}
