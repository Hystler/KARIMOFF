import { saveProductPortionsAction } from "@/app/admin/products/portion-actions";
import { getImportedPortions } from "@/lib/product-portions";
import { getPortionGroup } from "@/lib/product-serving";
import type { Product } from "@/lib/product-types";

export function ProductPortions({ product }: { product: Product }) {
  const group = getPortionGroup(product);
  const portions = group ? group.options.map(option => ({ label: option.label, quantity: option.quantity_delta, price: product.price + option.price_delta })) : getImportedPortions(product.slug);
  if (!portions.length) return null;
  return <section className="mt-8 border-t border-karimoff-line pt-6">
    <h2 className="text-2xl font-bold text-karimoff-black">Размеры порций</h2>
    {!group ? <p className="mt-2 text-sm text-karimoff-muted">Цены из прежнего меню. Проверьте перед сохранением. Каталог общий для сайта и стенда.</p> : null}
    <form action={saveProductPortionsAction} className="mt-4 grid gap-4">
      <input type="hidden" name="product_id" value={product.id} />
      {portions.map(portion => <label key={portion.quantity} className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 text-sm font-bold text-karimoff-black">
        <span>{portion.label}</span><input type="hidden" name="portion_quantity" value={portion.quantity} />
        <span><span className="mb-1 block text-xs text-karimoff-muted">Цена, ₽</span><input name="portion_price" inputMode="decimal" required defaultValue={portion.price} className="admin-control" /></span>
      </label>)}
      <button type="submit" className="admin-primary-button justify-self-start">Сохранить порции</button>
    </form>
  </section>;
}
