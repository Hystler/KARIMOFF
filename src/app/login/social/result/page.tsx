import Link from "next/link";
import { SocialAuthResult } from "@/components/auth/SocialAuthResult";
import { Logo } from "@/components/Logo";
import { getCustomerSession } from "@/lib/customer-auth";
import { sanitizeSocialRedirect } from "@/lib/auth/social/redirect";
import { isSocialProvider, type SocialProvider } from "@/lib/auth/social/types";

export const dynamic = "force-dynamic";

type SocialResultPageProps = {
  searchParams?: Promise<{
    status?: string;
    provider?: string;
    returnTo?: string;
    reason?: string;
    linked?: string;
  }>;
};

export default async function SocialResultPage({ searchParams }: SocialResultPageProps) {
  const params = searchParams ? await searchParams : {};
  const rawProvider = params.provider ?? "";
  const provider: SocialProvider = isSocialProvider(rawProvider) ? rawProvider : "telegram";
  const returnTo = sanitizeSocialRedirect(params.returnTo);
  const requestedSuccess = params.status === "success";
  const customerSession = requestedSuccess ? await getCustomerSession() : null;
  const status = requestedSuccess && customerSession ? "success" : "error";
  const reason = requestedSuccess && !customerSession ? "session_expired" : params.reason;

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 pb-10 pt-24 text-karimoff-black sm:pt-28">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Logo compact />
          <Link href="/" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">На главную</Link>
        </div>
        <SocialAuthResult
          status={status}
          provider={provider}
          returnTo={returnTo}
          reason={reason}
          linked={params.linked === "1"}
        />
      </div>
    </main>
  );
}
