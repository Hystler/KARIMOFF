import type { ReactNode } from "react";
import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { getCurrentStaff } from "@/lib/admin-auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) return children;
  return <AdminWorkspaceShell staff={staff}>{children}</AdminWorkspaceShell>;
}
