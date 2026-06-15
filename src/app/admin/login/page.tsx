import Link from "next/link";
import { loginAction } from "./actions";

const errorMessages: Record<string, string> = {
  invalid: "Неверный телефон или пароль.",
  not_configured: "ADMIN_PHONE и ADMIN_PASSWORD не заполнены в env."
};

type AdminLoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : null;

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-8 text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          На сайт KARIMOFF
        </Link>
        <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-4xl font-black leading-none">Вход</h1>
          <form action={loginAction} className="mt-8 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
              <input
                name="phone"
                type="tel"
                required
                autoComplete="username"
                placeholder="+7"
                className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-karimoff-muted">Пароль</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
              />
            </label>
            {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="mt-2 rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              Войти
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
