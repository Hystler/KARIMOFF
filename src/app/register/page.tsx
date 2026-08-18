import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { getConfiguredSocialProviders } from "@/lib/auth/social/config";

type RegisterPageProps = {
  searchParams?: Promise<{
    next?: string;
    redirectTo?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 pb-10 pt-24 text-karimoff-black sm:pt-28">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-5 text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          На сайт KARIMOFF
        </Link>
        <AuthForm
          mode="register"
          next={params.next}
          redirectTo={params.redirectTo}
          socialProviders={getConfiguredSocialProviders()}
        />
      </div>
    </main>
  );
}
