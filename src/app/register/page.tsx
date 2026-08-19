import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { Logo } from "@/components/Logo";
import { getConfiguredSocialProviders, shouldRequestSocialPhone } from "@/lib/auth/social/config";

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

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 pb-10 pt-24 text-karimoff-black sm:pt-28">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Logo compact />
          <Link href="/" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">На главную</Link>
        </div>
        <AuthForm
          mode="register"
          next={params.next}
          redirectTo={returnTo}
          socialProviders={getConfiguredSocialProviders()}
          requestSocialPhone={shouldRequestSocialPhone()}
        />
      </div>
    </main>
  );
}
