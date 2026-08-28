import { redirect } from "next/navigation";
import { AuthDocumentLink } from "@/components/auth/AuthDocumentLink";
import { SocialCompleteForm } from "@/components/auth/SocialCompleteForm";
import { Logo } from "@/components/Logo";
import { readPendingSocialIdentity } from "@/lib/auth/social/state";

export const dynamic = "force-dynamic";

export default async function SocialCompletePage() {
  const pending = await readPendingSocialIdentity();
  if (!pending) redirect("/login?socialError=session_expired");
  const claims = pending.claims as { displayName?: string | null };
  return (
    <main className="min-h-screen bg-karimoff-cream px-5 pb-10 pt-24 text-karimoff-black sm:pt-28">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Logo compact />
          <AuthDocumentLink href="/login" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">Вернуться ко входу</AuthDocumentLink>
        </div>
        <SocialCompleteForm
          provider={pending.provider}
          suggestedName={typeof claims.displayName === "string" ? claims.displayName : ""}
        />
      </div>
    </main>
  );
}
