import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-[72vh] bg-karimoff-cream px-page-mobile pb-16 pt-28 sm:px-page-tablet sm:pt-32">
      <section className="mx-auto flex min-h-[52vh] max-w-3xl flex-col items-center justify-center py-12 text-center">
        <p className="font-heading text-8xl font-black leading-none text-karimoff-orange-contrast sm:text-9xl" aria-hidden="true">404</p>
        <h1 className="mt-5 text-3xl font-black leading-tight text-karimoff-black sm:text-4xl">Такой страницы нет</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-karimoff-muted">
          Здесь ничего не нашлось. Загляните в меню или вернитесь на главную.
        </p>
        <div className="mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href="/menu" className="public-button-primary min-h-12 w-full sm:w-auto">
            В меню
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
          <Link href="/" className="public-button-secondary min-h-12 w-full sm:w-auto">
            <Home aria-hidden="true" size={18} />
            На главную
          </Link>
        </div>
      </section>
    </main>
  );
}
