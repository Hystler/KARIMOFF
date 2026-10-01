# KARIMOFF frontend spacing system V1

This is the measured starting system for customer pages and shared controls in the first polish pass. It does not require a project-wide conversion of existing Tailwind classes.

## Canonical rhythm

| Token | Value | Typical use |
| --- | ---: | --- |
| `space-1` | 4 px | compact label/icon separation |
| `space-2` | 8 px | related controls and dense rows |
| `space-3` | 12 px | compact card interiors and control gaps |
| `space-4` | 16 px | modifier option spacing, standard card/grid gap |
| `space-5` | 24 px | modifier group separation and section rhythm |
| `space-6` | 32 px | major section separation |
| `space-7` | 40 px | roomy section separation |
| `space-8` | 48 px | large page breaks |
| `space-9` | 64 px | hero/major layout rhythm |
| `space-10` | 80 px | exceptional large separation |

Page gutters are 20 px mobile, 32 px tablet/small desktop, and 40 px desktop. `container-page` uses a customer max-width of 1280 px, including its gutters. Product grids use 16 px as the default gutter; 24 px remains suitable for a deliberately open selection. The homepage product catalog remains in place.

## Components

| Component | V1 target |
| --- | ---: |
| Customer standard action | 48 px minimum height |
| Customer mobile purchase action | 56 px minimum height |
| Customer field | 48 px minimum height |
| ERP action / field | 40–44 px |
| POS/KDS action | 44–56 px by operational priority |
| Dense control radius | 6 px |
| Customer button/card radius | 8 px |
| Major panel/modal radius | 12 px |

Product details use 16 px between options inside a modifier group and 24 px between groups. Composition, nutrition, modifiers, and note remain separate reading blocks, with 24–32 px for main section transitions.

## Values intentionally retained outside the scale

These values size content or satisfy platform/layout constraints; they are not general-purpose spacing steps.

- `env(safe-area-inset-*)` plus local padding on fixed purchase, cookie, and cart layers: device-safe placement, not a page gutter.
- 44 px POS/Product modifier hit areas and the 56 px purchase CTA: touch targets and primary action hierarchy.
- 96 px minimum textarea height in product note and lead/cart forms: useful writing area.
- 280/310 px analytics SVG chart heights, and the 620 px heatmap scroll minimum: preserve legibility of dense data; the heatmap scrolls inside its panel.
- 88/104/116/142/168/190 px minimum heights in data modules: content proportions and chart/card stability, not shared card padding.
- `minmax(...)`, fixed table columns, 220–280 px operational sidebars, and wide POS/KDS canvas max-widths: information density and work-surface layout.
- Hero/viewport calculations and explicit image ratios: composition and viewport sizing. Hero is excluded from this iteration.
- SVG mark sizing at `1.22em` and optical baseline alignment: the existing panda-to-word proportion.

Unmodified ERP/POS/KDS areas still contain local arbitrary Tailwind spacing values. They remain until a screen-specific review confirms the correct density and responsive behavior; this pass intentionally replaces only the obvious duplicates and the touched customer/control foundations.

## Implementation

The CSS variables live in `src/app/globals.css`; Tailwind exposes `space-*`, page gutter, customer width, radius, and surface shadow utilities through `tailwind.config.ts`. These web tokens are also summarized for future native reuse in `docs/mobile-ui-readiness.md`.
