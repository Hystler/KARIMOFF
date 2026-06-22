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

export type CartLine = {
  product: Pick<Product, "id" | "name" | "slug" | "price" | "image_url">;
  quantity: number;
};

type CartContextValue = {
  lines: CartLine[];
  isOpen: boolean;
  totalItems: number;
  totalPrice: number;
  addItem: (product: Product) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  checkout: () => void;
};

const STORAGE_KEY = "karimoff_cart";

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

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setLines(JSON.parse(saved) as CartLine[]);
        }
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

    return undefined;
  }, [isHydrated]);

  const totalItems = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const totalPrice = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.product.price, 0),
    [lines]
  );

  const addItem = useCallback((product: Product) => {
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }

      return [...current, { product: toCartProduct(product), quantity: 1 }];
    });
    setIsOpen(true);
  }, []);

  const increment = useCallback((productId: string) => {
    setLines((current) =>
      current.map((line) => (line.product.id === productId ? { ...line, quantity: line.quantity + 1 } : line))
    );
  }, []);

  const decrement = useCallback((productId: string) => {
    setLines((current) =>
      current
        .map((line) => (line.product.id === productId ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
  }, []);

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
