"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { Product, ProductModifierGroup, ProductModifierOption } from "@/lib/product-types";
import { makeCartLineId as makeLineId } from "@/lib/cart-line-key";
import { readRepeatOrderNotice, saveRepeatOrderNotice } from "@/lib/repeat-order-notice";
import { buildReplacementCartLines } from "@/lib/replacement-cart";
import type { RepeatCartItem, RepeatOrderIssue } from "@/lib/repeat-order";
import { CART_STORAGE_KEY } from "@/lib/cart-checkout-storage";
import { useRouter } from "next/navigation";

export type CartRemovedIngredient = {
  ingredient_id: string;
  name: string;
};

export type CartExtra = {
  ingredient_id: string;
  name: string;
  quantity: number;
  unit_price: number;
};

export type CartCustomization = {
  removed: CartRemovedIngredient[];
  extras: CartExtra[];
  modifierOptionIds: string[];
  note: string;
};

type CartProduct = Pick<Product, "id" | "name" | "slug" | "price" | "image_url"> & {
  modifier_options?: ProductModifierOption[];
  modifier_groups?: ProductModifierGroup[];
};

export type CartLine = {
  lineId: string;
  product: CartProduct;
  quantity: number;
  customization: CartCustomization;
};

type CartContextValue = {
  lines: CartLine[];
  isOpen: boolean;
  totalItems: number;
  totalPrice: number;
  addAnimationKey: number;
  addItem: (product: Product, customization?: CartCustomization, quantity?: number) => void;
  updateCustomization: (lineId: string, customization: CartCustomization) => void;
  increment: (lineId: string) => void;
  decrement: (lineId: string) => void;
  removeItem: (lineId: string) => void;
  clearCart: () => void;
  replaceCart: (items: RepeatCartItem[], issues?: RepeatOrderIssue[]) => void;
  repeatOrderIssues: RepeatOrderIssue[];
  openCart: () => void;
  closeCart: () => void;
  checkout: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function getDefaultCartCustomization(product: Product | CartProduct): CartCustomization {
  return {
    removed: [],
    extras: [],
    modifierOptionIds: (product.modifier_groups ?? [])
      .flatMap((group) => group.options.filter((option) => option.is_default).map((option) => option.id))
      .sort(),
    note: ""
  };
}

export function isCartCustomizationValid(product: Product | CartProduct, customization: CartCustomization) {
  const selected = new Set(customization.modifierOptionIds);
  return (product.modifier_groups ?? []).every((group) => {
    const count = group.options.filter((option) => selected.has(option.id)).length;
    return count >= group.min_selections && count <= group.max_selections;
  });
}

function normalizeCustomization(customization: Partial<CartCustomization>): CartCustomization {
  return {
    removed: Array.isArray(customization.removed) ? [...customization.removed] : [],
    extras: Array.isArray(customization.extras)
      ? customization.extras.filter((extra) => Number(extra.quantity) > 0)
      : [],
    modifierOptionIds: Array.isArray(customization.modifierOptionIds)
      ? [...new Set(customization.modifierOptionIds.map(String))].sort()
      : [],
    note: typeof customization.note === "string" ? customization.note.trim().slice(0, 300) : ""
  };
}

function toCartProduct(product: Product): CartProduct {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: product.price,
    image_url: product.image_url,
    modifier_options: product.modifier_options ?? [],
    modifier_groups: product.modifier_groups ?? []
  };
}

export function getConfiguredCartUnitPrice(product: CartProduct, customization: CartCustomization) {
  const extras = customization.extras.reduce(
    (sum, extra) => sum + extra.unit_price * extra.quantity,
    0
  );
  const selectedOptions = new Map(
    (product.modifier_groups ?? []).flatMap((group) =>
      group.options.map((option) => [option.id, option] as const)
    )
  );
  const groups = customization.modifierOptionIds.reduce(
    (sum, optionId) => sum + (selectedOptions.get(optionId)?.price_delta ?? 0),
    0
  );

  return product.price + extras + groups;
}

export function getCartLineUnitPrice(line: CartLine) {
  return getConfiguredCartUnitPrice(line.product, line.customization);
}

function normalizeStoredLine(line: Partial<CartLine>): CartLine | null {
  if (!line.product?.id || !line.product.name || !line.product.slug) {
    return null;
  }

  const customization = normalizeCustomization(line.customization ?? {});

  return {
    lineId: line.lineId || makeLineId(line.product.id, customization),
    product: {
      id: line.product.id,
      name: line.product.name,
      slug: line.product.slug,
      price: Number(line.product.price ?? 0),
      image_url: line.product.image_url ?? null,
      modifier_options: Array.isArray(line.product.modifier_options)
        ? line.product.modifier_options
        : [],
      modifier_groups: Array.isArray(line.product.modifier_groups)
        ? line.product.modifier_groups
        : []
    },
    quantity: Math.max(1, Number(line.quantity ?? 1)),
    customization
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [addAnimationKey, setAddAnimationKey] = useState(0);
  const replacementPending = useRef(false);
  const [repeatOrderIssues, setRepeatOrderIssues] = useState<RepeatOrderIssue[]>([]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (replacementPending.current) return;
      try {
        const saved = window.localStorage.getItem(CART_STORAGE_KEY);
        const parsed = saved ? (JSON.parse(saved) as Partial<CartLine>[]) : [];
        setRepeatOrderIssues(readRepeatOrderNotice(saved ?? "[]"));
        setLines(parsed.map(normalizeStoredLine).filter((line): line is CartLine => Boolean(line)));
      } catch {
        setLines([]);
      } finally {
        setIsHydrated(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      const snapshot = JSON.stringify(lines);
      window.localStorage.setItem(CART_STORAGE_KEY, snapshot);
      saveRepeatOrderNotice(snapshot, repeatOrderIssues);
    }
  }, [isHydrated, lines, repeatOrderIssues]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get("checkout") === "1") {
      const timeoutId = window.setTimeout(() => {
        setIsOpen(true);
        window.dispatchEvent(new Event("karimoff-cart-checkout-request"));
      }, 100);
      searchParams.delete("checkout");
      const nextSearch = searchParams.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", nextUrl);
      return () => window.clearTimeout(timeoutId);
    }
  }, [isHydrated]);

  useEffect(() => {
    function clearAfterPayment(event: Event) {
      const detail = (event as CustomEvent<{ clear?: boolean }>).detail;
      if (detail?.clear === false) return;
      setLines([]);
      setRepeatOrderIssues([]);
      saveRepeatOrderNotice("[]", []);
      setIsOpen(false);
    }
    window.addEventListener("karimoff-cart-clear-after-payment", clearAfterPayment);
    return () => window.removeEventListener("karimoff-cart-clear-after-payment", clearAfterPayment);
  }, []);

  const totalItems = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const totalPrice = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * getCartLineUnitPrice(line), 0),
    [lines]
  );

  const addItem = useCallback((product: Product, customization?: CartCustomization, quantity = 1) => {
    const normalizedCustomization = normalizeCustomization(
      customization ?? getDefaultCartCustomization(product)
    );
    const safeQuantity = Math.max(1, Math.min(20, Math.trunc(quantity)));
    const lineId = makeLineId(product.id, normalizedCustomization);

    setLines((current) => {
      const existing = current.find((line) => line.lineId === lineId);
      if (existing) {
        return current.map((line) =>
          line.lineId === lineId
            ? { ...line, quantity: Math.min(20, line.quantity + safeQuantity) }
            : line
        );
      }

      return [
        ...current,
        {
          lineId,
          product: toCartProduct(product),
          quantity: safeQuantity,
          customization: normalizedCustomization
        }
      ];
    });
    setAddAnimationKey((current) => current + 1);
  }, []);

  const updateCustomization = useCallback((lineId: string, customization: CartCustomization) => {
    const normalizedCustomization = normalizeCustomization(customization);

    setLines((current) => {
      const target = current.find((line) => line.lineId === lineId);
      if (!target) return current;

      const nextLineId = makeLineId(target.product.id, normalizedCustomization);
      const duplicate = current.find((line) => line.lineId === nextLineId && line.lineId !== lineId);

      if (duplicate) {
        return current
          .filter((line) => line.lineId !== lineId)
          .map((line) =>
            line.lineId === duplicate.lineId
              ? { ...line, quantity: Math.min(20, line.quantity + target.quantity) }
              : line
          );
      }

      return current.map((line) =>
        line.lineId === lineId
          ? { ...line, lineId: nextLineId, customization: normalizedCustomization }
          : line
      );
    });
  }, []);

  const increment = useCallback((lineId: string) => {
    setLines((current) =>
      current.map((line) =>
        line.lineId === lineId ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line
      )
    );
  }, []);

  const decrement = useCallback((lineId: string) => {
    setLines((current) =>
      current
        .map((line) => (line.lineId === lineId ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((lineId: string) => {
    setLines((current) => current.filter((line) => line.lineId !== lineId));
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setRepeatOrderIssues([]);
    saveRepeatOrderNotice("[]", []);
  }, []);

  const replaceCart = useCallback((items: RepeatCartItem[], issues: RepeatOrderIssue[] = []) => {
    // Build the complete next state first; a failed validation leaves today's cart untouched.
    const nextLines = buildReplacementCartLines(items);
    replacementPending.current = true;
    setLines(nextLines);
    setRepeatOrderIssues(issues);
    setIsHydrated(true);
    setIsOpen(false);
    const snapshot = JSON.stringify(nextLines);
    saveRepeatOrderNotice(snapshot, issues);
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, snapshot);
    } catch {
      // The in-memory cart still works when browser storage is unavailable.
    }
  }, []);

  const checkout = useCallback(() => {
    if (!lines.length) {
      return;
    }

    if (window.location.pathname !== "/checkout") {
      router.push("/checkout");
      return;
    }

    setIsOpen(true);
    window.dispatchEvent(new Event("karimoff-cart-checkout-request"));
  }, [lines, router]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      isOpen,
      totalItems,
      totalPrice,
      addAnimationKey,
      addItem,
      updateCustomization,
      increment,
      decrement,
      removeItem,
      clearCart,
      replaceCart,
      repeatOrderIssues,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      checkout
    }),
    [addAnimationKey, addItem, checkout, clearCart, decrement, increment, isOpen, lines, removeItem, repeatOrderIssues, replaceCart, totalItems, totalPrice, updateCustomization]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used inside CartProvider");
  }

  return context;
}
