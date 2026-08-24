import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminWorkspaceShell } from "@/components/admin/AdminWorkspaceShell";
import { getCurrentStaff } from "@/lib/admin-auth";
import { isAdminHostAllowed, requestHostname } from "@/lib/admin-host";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const headerStore = await headers();
  if (!isAdminHostAllowed({
    host: requestHostname(headerStore),
    appOrigin: process.env.APP_ORIGIN,
    nodeEnv: process.env.NODE_ENV,
    testOrderMode: process.env.TEST_ORDER_MODE
  })) {
    notFound();
  }

  const staff = await getCurrentStaff();
  if (!staff) return children;
  return <AdminWorkspaceShell staff={staff}>{children}</AdminWorkspaceShell>;
}
