"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorHash, getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { getDefaultDeliveryLocationId } from "@/lib/delivery/address-whitelist";
import { assessDeliveryPoint } from "@/lib/delivery/address-geometry.mjs";
import { normalizeBuilding, normalizeHouse, normalizeStreet } from "@/lib/delivery/address-normalization.mjs";
import { getPostgresSql } from "@/lib/postgres/server";

const pagePath = "/admin/delivery-addresses";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireDeliveryAdmin() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin"].includes(staff.role)) redirect("/admin");
  return staff;
}

function auditActor(staff: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>>) {
  return staff.id
    ? { actorType: "staff" as const, actorId: staff.id }
    : { actorType: "admin" as const, actorRefHash: getAdminActorHash() };
}

function clean(value: FormDataEntryValue | null, limit: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

async function getLocationId() {
  const locationId = await getDefaultDeliveryLocationId();
  if (!locationId) redirect(`${pagePath}?error=location`);
  return locationId;
}

function revalidateAddressViews() {
  revalidatePath(pagePath);
  revalidatePath("/checkout");
}

function validUuid(value: string) {
  return uuidPattern.test(value);
}

export async function saveManualDeliveryAddressAction(formData: FormData) {
  const staff = await requireDeliveryAdmin();
  const locationId = await getLocationId();
  const city = clean(formData.get("city"), 100) || null;
  const street = clean(formData.get("street"), 160);
  const house = clean(formData.get("house"), 40);
  const building = clean(formData.get("building"), 40);
  const displayName = clean(formData.get("display_name"), 120) || null;
  const postalCode = clean(formData.get("postal_code"), 20) || null;
  const latitude = Number(String(formData.get("latitude") ?? "").replace(",", "."));
  const longitude = Number(String(formData.get("longitude") ?? "").replace(",", "."));
  const enableNow = formData.get("is_available") === "on";
  const streetNormalized = normalizeStreet(street);
  const houseNormalized = normalizeHouse(house);
  const buildingNormalized = normalizeBuilding(building);

  if (!street || !house || !streetNormalized || !houseNormalized
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    redirect(`${pagePath}?error=fields`);
  }
  const assessment = assessDeliveryPoint([longitude, latitude]);
  if (!assessment.inRadius || assessment.excludedByAerodrome) redirect(`${pagePath}?error=outside`);
  if (enableNow && !assessment.available) redirect(`${pagePath}?error=outside`);

  const sql = getPostgresSql();
  let addressId = "";
  try {
    const [existingStreet] = await sql<{ street: string }[]>`
      select min(street) as street from public.delivery_addresses
      where location_id = ${locationId}::uuid and street_normalized = ${streetNormalized}
    `;
    const canonicalStreet = existingStreet?.street ?? street;
    const [address] = await sql<{ id: string }[]>`
      insert into public.delivery_addresses (
        location_id, city, street, street_normalized, house, house_normalized,
        building, building_normalized, display_name, postal_code, source, source_id,
        source_ids, latitude, longitude, distance_meters, aerodrome_boundary_distance_meters,
        coordinate_spread_meters, duplicate_count, review_reasons, is_available,
        disabled_reason, imported_at
      ) values (
        ${locationId}::uuid, ${city}, ${canonicalStreet}, ${streetNormalized}, ${house}, ${houseNormalized},
        ${building}, ${buildingNormalized}, ${displayName}, ${postalCode}, 'manual', ${`manual/${randomUUID()}`},
        array[]::text[], ${latitude}, ${longitude}, ${Math.round(assessment.distanceMeters)},
        ${assessment.boundaryDistanceMeters}, 0, 1,
        ${enableNow ? [] : ["MANUAL_ENTRY_REVIEW"]}, ${enableNow},
        ${enableNow ? null : "manual_review_required"}, null
      ) returning id
    `;
    addressId = address.id;
  } catch (error) {
    const code = (error as { code?: string }).code;
    redirect(`${pagePath}?error=${code === "23505" ? "duplicate" : "save"}`);
  }

  await writeAuditLog({
    action: enableNow ? "delivery_address.manual_created_approved" : "delivery_address.manual_created_review",
    ...auditActor(staff),
    entityType: "delivery_address",
    entityId: addressId,
    metadata: { location_id: locationId, street_normalized: streetNormalized, house_normalized: houseNormalized }
  });
  revalidateAddressViews();
  redirect(`${pagePath}?saved=created`);
}

export async function updateDeliveryAddressDisplayNameAction(formData: FormData) {
  const staff = await requireDeliveryAdmin();
  const locationId = await getLocationId();
  const id = clean(formData.get("id"), 36);
  const displayName = clean(formData.get("display_name"), 120) || null;
  if (!validUuid(id)) redirect(`${pagePath}?error=id`);
  const sql = getPostgresSql();
  const [address] = await sql<{ id: string }[]>`
    update public.delivery_addresses set display_name = ${displayName}, updated_at = now()
    where id = ${id}::uuid and location_id = ${locationId}::uuid returning id
  `;
  if (!address) redirect(`${pagePath}?error=missing`);
  await writeAuditLog({
    action: "delivery_address.display_name_updated",
    ...auditActor(staff),
    entityType: "delivery_address",
    entityId: id,
    metadata: { display_name_changed: true }
  });
  revalidateAddressViews();
  redirect(`${pagePath}?saved=updated`);
}

export async function setDeliveryAddressAvailabilityAction(formData: FormData) {
  const staff = await requireDeliveryAdmin();
  const locationId = await getLocationId();
  const id = clean(formData.get("id"), 36);
  const enabled = formData.get("is_available") === "true";
  if (!validUuid(id)) redirect(`${pagePath}?error=id`);
  const sql = getPostgresSql();
  const [address] = await sql<{ id: string; latitude: string; longitude: string }[]>`
    select id, latitude::text, longitude::text from public.delivery_addresses
    where id = ${id}::uuid and location_id = ${locationId}::uuid
  `;
  if (!address) redirect(`${pagePath}?error=missing`);
  const assessment = assessDeliveryPoint([Number(address.longitude), Number(address.latitude)]);
  if (enabled && !assessment.available) redirect(`${pagePath}?error=outside`);

  await sql`
    update public.delivery_addresses set
      is_available = ${enabled},
      disabled_reason = ${enabled ? null : "admin_disabled"},
      review_reasons = case when ${enabled} then '{}'::text[] else review_reasons end,
      updated_at = now()
    where id = ${id}::uuid and location_id = ${locationId}::uuid
  `;
  await writeAuditLog({
    action: enabled ? "delivery_address.enabled" : "delivery_address.disabled",
    ...auditActor(staff),
    entityType: "delivery_address",
    entityId: id,
    metadata: { location_id: locationId }
  });
  revalidateAddressViews();
  redirect(`${pagePath}?saved=${enabled ? "enabled" : "disabled"}`);
}

export async function bulkReviewDeliveryAddressesAction(formData: FormData) {
  const staff = await requireDeliveryAdmin();
  const locationId = await getLocationId();
  const action = String(formData.get("review_action") ?? "");
  const ids = [...new Set(formData.getAll("address_id").filter((value): value is string => typeof value === "string"))];
  if (!ids.length || ids.length > 500 || ids.some((id) => !validUuid(id)) || !["approve", "reject"].includes(action)) {
    redirect(`${pagePath}?error=selection`);
  }

  const sql = getPostgresSql();
  const rows = await sql<{ id: string; latitude: string; longitude: string }[]>`
    select id, latitude::text, longitude::text from public.delivery_addresses
    where location_id = ${locationId}::uuid and id = any(${ids}::uuid[])
      and disabled_reason = 'manual_review_required' and not is_available
  `;
  if (rows.length !== ids.length) redirect(`${pagePath}?error=selection`);
  let allowedIds = rows.map((row) => row.id);
  if (action === "approve") {
    allowedIds = rows.filter((row) => assessDeliveryPoint([
      Number(row.longitude), Number(row.latitude)
    ]).available).map((row) => row.id);
    if (allowedIds.length !== rows.length) redirect(`${pagePath}?error=outside`);
  }
  await sql`
    update public.delivery_addresses set
      is_available = ${action === "approve"},
      disabled_reason = ${action === "approve" ? null : "rejected_by_admin"},
      review_reasons = case when ${action === "approve"} then '{}'::text[] else review_reasons end,
      updated_at = now()
    where location_id = ${locationId}::uuid and id = any(${allowedIds}::uuid[])
  `;
  await writeAuditLog({
    action: action === "approve" ? "delivery_address.bulk_approved" : "delivery_address.bulk_rejected",
    ...auditActor(staff),
    entityType: "delivery_address",
    metadata: { location_id: locationId, count: allowedIds.length }
  });
  revalidateAddressViews();
  redirect(`${pagePath}?mode=review&saved=${action === "approve" ? "bulk_approved" : "bulk_rejected"}`);
}
