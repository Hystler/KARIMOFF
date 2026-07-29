import { Wrench } from "lucide-react";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

export function MaintenanceBanner() {
  return (
    <div
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-2xl items-center gap-3 rounded-lg border border-white/15 bg-karimoff-black px-4 py-3 text-sm font-semibold leading-5 text-white shadow-[0_18px_50px_rgba(18,18,20,0.28)] sm:inset-x-6 sm:bottom-6 sm:px-5"
      role="status"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-karimoff-orange text-white">
        <Wrench aria-hidden="true" size={18} strokeWidth={2.2} />
      </span>
      <span>{MAINTENANCE_MESSAGE}</span>
    </div>
  );
}
