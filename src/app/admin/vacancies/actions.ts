"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { vacancyFormSchema, type VacancyFormInput } from "@/lib/vacancy-schema";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function getSupabaseOrRedirect() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/vacancies?error=supabase");
  }

  return supabase;
}

function getVacancyId(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/vacancies?error=missing_id");
  }

  return id;
}

function parseVacancyForm(formData: FormData) {
  return vacancyFormSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    department: formData.get("department"),
    employment_type: formData.get("employment_type"),
    salary_from: formData.get("salary_from") || undefined,
    salary_to: formData.get("salary_to") || undefined,
    salary_unit: formData.get("salary_unit") || "hour",
    location: formData.get("location"),
    schedule: formData.get("schedule"),
    description: formData.get("description"),
    requirements: formData.get("requirements"),
    responsibilities: formData.get("responsibilities"),
    benefits: formData.get("benefits"),
    sort_order: formData.get("sort_order") || 100,
    is_active: formData.get("is_active") === "on"
  });
}

function nullableText(value: string | undefined) {
  return value && value.length > 0 ? value : null;
}

function nullableNumber(value: number | undefined) {
  return value === undefined || Number.isNaN(value) ? null : value;
}

function toPayload(data: VacancyFormInput) {
  return {
    title: data.title,
    slug: data.slug,
    department: nullableText(data.department),
    employment_type: nullableText(data.employment_type),
    salary_from: nullableNumber(data.salary_from),
    salary_to: nullableNumber(data.salary_to),
    salary_unit: data.salary_unit || "hour",
    location: nullableText(data.location),
    schedule: nullableText(data.schedule),
    description: nullableText(data.description),
    requirements: nullableText(data.requirements),
    responsibilities: nullableText(data.responsibilities),
    benefits: nullableText(data.benefits),
    sort_order: data.sort_order,
    is_active: data.is_active
  };
}

function revalidateVacancyViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/vacancies");
  revalidatePath("/careers");
}

export async function createVacancyAction(formData: FormData) {
  await requireAdmin();

  const parsed = parseVacancyForm(formData);

  if (!parsed.success) {
    redirect(`/admin/vacancies/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("vacancies").insert(toPayload(parsed.data));

  if (error) {
    redirect(`/admin/vacancies/new?error=${encodeURIComponent("Не удалось сохранить вакансию. Проверьте SQL и уникальность slug.")}`);
  }

  revalidateVacancyViews();
  redirect("/admin/vacancies?saved=1");
}

export async function updateVacancyAction(formData: FormData) {
  await requireAdmin();

  const id = getVacancyId(formData);
  const parsed = parseVacancyForm(formData);

  if (!parsed.success) {
    redirect(`/admin/vacancies/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("vacancies").update(toPayload(parsed.data)).eq("id", id);

  if (error) {
    redirect(`/admin/vacancies/${id}/edit?error=${encodeURIComponent("Не удалось сохранить вакансию. Проверьте SQL и уникальность slug.")}`);
  }

  revalidateVacancyViews();
  redirect("/admin/vacancies?saved=1");
}

export async function toggleVacancyActiveAction(formData: FormData) {
  await requireAdmin();

  const id = getVacancyId(formData);
  const nextActive = String(formData.get("next_active") || "") === "true";
  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("vacancies").update({ is_active: nextActive }).eq("id", id);

  if (error) {
    redirect("/admin/vacancies?error=save_failed");
  }

  revalidateVacancyViews();
  redirect("/admin/vacancies?saved=1");
}

export async function deleteVacancyAction(formData: FormData) {
  await requireAdmin();

  const id = getVacancyId(formData);
  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("vacancies").delete().eq("id", id);

  if (error) {
    redirect("/admin/vacancies?error=delete_failed");
  }

  revalidateVacancyViews();
  redirect("/admin/vacancies?deleted=1");
}
