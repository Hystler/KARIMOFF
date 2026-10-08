"use client";

import { Check, ShoppingBasket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getDefaultCartCustomization,
  isCartCustomizationValid,
  useCart
} from "@/components/cart/CartProvider";
import type { Product } from "@/lib/product-types";
import { getPortionGroup } from "@/lib/product-serving";

export function ProductCustomizer({ product }: { product: Product }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [isAdded, setIsAdded] = useState(false);
  const portionGroup = getPortionGroup(product);
  const needsConfiguration = Boolean(portionGroup) ||
    Boolean(product.modifier_options?.some((option) => option.is_removable || option.is_extra_available)) ||
    Boolean(product.modifier_groups?.length);

  useEffect(() => {
    if (!isAdded) return undefined;
    const timeoutId = window.setTimeout(() => setIsAdded(false), 1100);
    return () => window.clearTimeout(timeoutId);
  }, [isAdded]);

  const actionLabel = portionGroup ? "Выбрать порцию" : needsConfiguration ? "Настроить" : "В корзину";
  const accessibleLabel = isAdded
    ? `${product.name} добавлен в корзину`
    : portionGroup
      ? `Выбрать порцию для ${product.name}`
      : needsConfiguration
        ? `Настроить ${product.name}`
        : `Добавить ${product.name} в корзину`;

  return (
    <button
      type="button"
      onClick={() => {
        const customization = getDefaultCartCustomization(product);
        if (needsConfiguration || !isCartCustomizationValid(product, customization)) {
          router.push(`/menu/${encodeURIComponent(product.slug)}`);
          return;
        }
        addItem(product, customization);
        setIsAdded(true);
      }}
      className={`public-button-primary product-cta gap-1 sm:gap-2 ${isAdded ? "product-cta-added" : ""}`}
      aria-live="polite"
      aria-label={accessibleLabel}
    >
      {isAdded ? <Check aria-hidden size={16} className="shrink-0 sm:size-[18px]" strokeWidth={2.8} /> : <ShoppingBasket aria-hidden size={16} className="shrink-0 sm:size-[18px]" strokeWidth={2.4} />}
      <span className="min-w-0 truncate">
        {isAdded ? "Добавлено" : portionGroup ? <><span className="sm:hidden">Выбрать</span><span className="hidden sm:inline">{actionLabel}</span></> : actionLabel}
      </span>
    </button>
  );
}
