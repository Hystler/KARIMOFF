import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { getCurrentStaff } from "@/lib/admin-auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) return children;
  return <AdminWorkspaceShell staff={staff}>{children}</AdminWorkspaceShell>;
}
