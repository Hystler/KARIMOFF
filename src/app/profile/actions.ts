"use server";

import { redirect } from "next/navigation";
import { clearCustomerSession } from "@/lib/customer-auth";

export async function logoutCustomerAction() {
  await clearCustomerSession();
  redirect("/");
}
