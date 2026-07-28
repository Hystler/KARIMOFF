"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { Product } from "@/lib/product-types";

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
};

export type CartLine = {
  lineId: string;
  product: Pick<Product, "id" | "name" | "slug" | "price" | "image_url">;
  quantity: number;
  customization: CartCustomization;
};

type CartContextValue = {
  lines: CartLine[];
  isOpen: boolean;
  totalItems: number;
  totalPrice: number;
  addItem: (product: Product, customization?: CartCustomization) => void;
  increment: (lineId: string) => void;
  decrement: (lineId: string) => void;
  removeItem: (lineId: string) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  checkout: () => void;
};

const STORAGE_KEY = "karimoff_cart";
const EMPTY_CUSTOMIZATION: CartCustomization = { removed: [], extras: [] };
const CartContext = createContext<CartContextValue | null>(null);

function toCartProduct(product: Product): CartLine["product"] {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: product.price,
    image_url: product.image_url
  };
}

function customizationKey(customization: CartCustomization) {
  const removed = customization.removed.map((item) => item.ingredient_id).sort().join(",");
  const extras = customization.extras
    .map((item) => `${item.ingredient_id}:${item.quantity}`)
    .sort()
    .join(",");

  return `${removed}|${extras}`;
}

function makeLineId(productId: string, customization: CartCustomization) {
  return `${productId}:${customizationKey(customization)}`;
}

export function getCartLineUnitPrice(line: CartLine) {
  const extras = line.customization.extras.reduce(
    (sum, extra) => sum + extra.unit_price * extra.quantity,
    0
  );

  return line.product.price + extras;
}

function normalizeStoredLine(line: Partial<CartLine>): CartLine | null {
  if (!line.product?.id || !line.product.name || !line.product.slug) {
    return null;
  }

  const customization: CartCustomization = {
    removed: Array.isArray(line.customization?.removed) ? line.customization.removed : [],
    extras: Array.isArray(line.customization?.extras) ? line.customization.extras : []
  };

  return {
    lineId: line.lineId || makeLineId(line.product.id, customization),
    product: {
      id: line.product.id,
      name: line.product.name,
      slug: line.product.slug,
      price: Number(line.product.price ?? 0),
      image_url: line.product.image_url ?? null
    },
    quantity: Math.max(1, Number(line.quantity ?? 1)),
    customization
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        const parsed = saved ? (JSON.parse(saved) as Partial<CartLine>[]) : [];
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    }
  }, [isHydrated, lines]);

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

  const totalItems = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const totalPrice = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * getCartLineUnitPrice(line), 0),
    [lines]
  );

  const addItem = useCallback((product: Product, customization = EMPTY_CUSTOMIZATION) => {
    const normalizedCustomization: CartCustomization = {
      removed: [...customization.removed],
      extras: customization.extras.filter((extra) => extra.quantity > 0)
    };
    const lineId = makeLineId(product.id, normalizedCustomization);

    setLines((current) => {
      const existing = current.find((line) => line.lineId === lineId);
      if (existing) {
        return current.map((line) =>
          line.lineId === lineId ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line
        );
      }

      return [
        ...current,
        {
          lineId,
          product: toCartProduct(product),
          quantity: 1,
          customization: normalizedCustomization
        }
      ];
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

  const clearCart = useCallback(() => setLines([]), []);

  const checkout = useCallback(() => {
    if (!lines.length) {
      return;
    }

    if (window.location.pathname !== "/checkout") {
      window.location.assign("/checkout");
      return;
    }

    setIsOpen(true);
    window.dispatchEvent(new Event("karimoff-cart-checkout-request"));
  }, [lines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      isOpen,
      totalItems,
      totalPrice,
      addItem,
      increment,
      decrement,
      removeItem,
      clearCart,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      checkout
    }),
    [addItem, checkout, clearCart, decrement, increment, isOpen, lines, removeItem, totalItems, totalPrice]
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
