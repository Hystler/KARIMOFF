import Link from "next/link";
import { PhoneInput } from "@/components/forms/PhoneInput";
import { isAdminTotpConfigured } from "@/lib/admin-auth";
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
  const error = params.error ? errorMessages[params.error] ?? params.error : null;
  const hasTotp = isAdminTotpConfigured();

  return (
    <main className="admin-page">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-5 text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          На сайт KARIMOFF
        </Link>
        <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-card sm:p-8">
          <h1 className="text-3xl font-black leading-tight">Вход</h1>
          <form action={loginAction} className="mt-6 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
              <PhoneInput
                name="phone"
                required
                autoComplete="username"
                className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
              />
            </label>
            {hasTotp ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-karimoff-muted">Код 2FA владельца</span>
                <input
                  name="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                  placeholder="Сотрудникам не нужен"
                />
              </label>
            ) : null}
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
              className="mt-1 min-h-12 rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] active:translate-y-0"
            >
              Войти
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
