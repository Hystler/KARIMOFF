import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { Logo } from "@/components/Logo";
import { getConfiguredSocialProviders } from "@/lib/auth/social/config";
import { isStagingUiMode } from "@/lib/staging-ui-mode";

type RegisterPageProps = {
  searchParams?: Promise<{
    next?: string;
    redirectTo?: string;
    returnTo?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = searchParams ? await searchParams : {};
  const returnTo = params.redirectTo ?? params.returnTo;
  const stagingUiMode = isStagingUiMode();

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 pb-10 pt-24 text-karimoff-black sm:pt-28">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Logo />
          <Link href="/" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange-contrast">На главную</Link>
        </div>
        {stagingUiMode ? (
          <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-card">
            <p className="text-lg font-black">Регистрация отключена</p>
            <p className="mt-2 text-sm leading-6 text-karimoff-muted">
              Для тестового оформления используется временный демо-профиль. Данные пользователя не записываются.
            </p>
            <Link href="/menu" className="public-button-primary mt-5 w-full">Перейти в меню</Link>
          </section>
        ) : (
          <AuthForm
            mode="register"
            next={params.next}
            redirectTo={returnTo}
            socialProviders={getConfiguredSocialProviders()}
          />
        )}
      </div>
    </main>
  );
}
