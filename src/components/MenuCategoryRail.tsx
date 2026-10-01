"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { menuCategoryFilters, type NormalizedProductCategory } from "@/lib/product-categories";

type CategoryFilter = (typeof menuCategoryFilters)[number];

export function MenuCategoryRail({
  filters,
  activeCategory
}: {
  filters: readonly CategoryFilter[];
  activeCategory: "all" | NormalizedProductCategory;
}) {
  const railRef = useRef<HTMLElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;

    function updateAffordance() {
      const element = railRef.current;
      if (!element) return;
      setCanScrollRight(element.scrollWidth > element.clientWidth + 1 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    }

    updateAffordance();
    rail.addEventListener("scroll", updateAffordance, { passive: true });
    window.addEventListener("resize", updateAffordance);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAffordance);
    resizeObserver?.observe(rail);

    return () => {
      rail.removeEventListener("scroll", updateAffordance);
      window.removeEventListener("resize", updateAffordance);
      resizeObserver?.disconnect();
    };
  }, [filters.length]);

  return (
    <div className="category-rail -mx-page-mobile mb-7 sm:mx-0">
      <nav ref={railRef} aria-label="Категории меню" className="scrollbar-hide flex gap-2 overflow-x-auto overflow-y-hidden px-page-mobile sm:flex-wrap sm:overflow-visible sm:px-0">
        {filters.map((filter) => {
          const isActive = activeCategory === filter.value;
          const href = filter.value === "all" ? "/menu" : `/menu?category=${filter.value}`;

          return (
            <Link key={filter.value} href={href} aria-current={isActive ? "page" : undefined} className={`public-filter-chip ${isActive ? "public-filter-chip-active" : ""}`}>
              {filter.label}
            </Link>
          );
        })}
      </nav>
      <div aria-hidden="true" className={`category-rail-hint ${canScrollRight ? "category-rail-hint-visible" : ""}`} />
    </div>
  );
}
