"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { rotateLoyaltyCard } from "@/lib/loyalty-card";

export async function rotateLoyaltyCardAction() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");
  await rotateLoyaltyCard(customer.id);
  revalidatePath("/profile/loyalty");
}
