import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

type RegisterPageProps = {
  searchParams?: Promise<{
    next?: string;
    redirectTo?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-8 text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          На сайт KARIMOFF
        </Link>
        <AuthForm mode="register" next={params.next} redirectTo={params.redirectTo} />
      </div>
    </main>
  );
}
