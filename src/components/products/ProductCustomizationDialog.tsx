"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { ProductDetailPurchase } from "@/components/products/ProductDetailPurchase";
import { getProductImageUrl } from "@/lib/product-image-url";
import type { Product } from "@/lib/product-types";

export function ProductCustomizationDialog({ product, open, onClose }: {
  product: Product;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const image = getProductImageUrl(product.image_url ?? "") || "/assets/products/placeholder-snack.svg";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      dialog.close();
      return;
    }
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.close();
    };
  }, [open]);

  return (
    <dialog ref={dialogRef} className="product-customization-dialog" aria-labelledby={titleId}
      onCancel={onClose} onClose={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="product-customization-content">
        <header className="flex items-start gap-3 border-b border-karimoff-line pb-4">
          <div className="product-photo relative size-20 shrink-0 overflow-hidden rounded-lg">
            {image.startsWith("/") && !image.endsWith(".svg") ? <Image src={image} alt="" fill sizes="80px" className="object-cover" /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="size-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={titleId} className="text-lg font-bold leading-6 text-karimoff-black">{product.name}</h2>
            {product.description ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-karimoff-muted">{product.description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="public-icon-button shrink-0" aria-label="Закрыть настройку блюда" autoFocus><X size={20} aria-hidden /></button>
        </header>
        <ProductDetailPurchase product={product} compact onAdded={onClose} />
      </div>
    </dialog>
  );
}
