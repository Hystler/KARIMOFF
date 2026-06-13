import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/components/admin/ProductForm";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminProductById } from "@/lib/products";
import { logoutAction } from "../../../login/actions";
import { updateProductAction } from "../../actions";

type EditProductPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params, searchParams }: EditProductPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const { id } = await params;
  const currentSearchParams = searchParams ? await searchParams : {};
  const { product, notConfigured, error } = await getAdminProductById(id);

  if (!notConfigured && !error && !product) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin/products" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Меню
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Редактировать товар</h1>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              Выйти
            </button>
          </form>
        </header>

        {notConfigured ? (
          <div className="mt-8 rounded-lg border border-karimoff-line bg-white p-8 text-karimoff-muted shadow-card">
            Supabase не подключён. Заполните переменные окружения.
          </div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-red-700">
            Не удалось загрузить товар: {error}
          </div>
        ) : (
          <>
            {currentSearchParams.error ? (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
                {decodeURIComponent(currentSearchParams.error)}
              </div>
            ) : null}
            <ProductForm action={updateProductAction} product={product} submitLabel="Сохранить товар" />
          </>
        )}
      </div>
    </main>
  );
}
