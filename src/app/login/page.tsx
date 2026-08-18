import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { getConfiguredSocialProviders } from "@/lib/auth/social/config";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string;
    redirectTo?: string;
    socialError?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const socialErrors: Record<string, string> = {
    unavailable: "Этот способ входа пока не настроен.",
    rate_limit: "Слишком много попыток. Попробуйте позже.",
    cancelled: "Вход отменён.",
    validation_failed: "Не удалось подтвердить безопасный вход. Попробуйте ещё раз.",
    session_expired: "Сессия входа истекла. Попробуйте ещё раз.",
    start_failed: "Не удалось открыть сервис входа. Попробуйте позже."
  };

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 pb-10 pt-24 text-karimoff-black sm:pt-28">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-5 text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          На сайт KARIMOFF
        </Link>
        <AuthForm
          mode="login"
          next={params.next}
          redirectTo={params.redirectTo}
          socialProviders={getConfiguredSocialProviders()}
          socialError={params.socialError ? socialErrors[params.socialError] ?? "Не удалось выполнить вход." : null}
        />
      </div>
    </main>
  );
}
