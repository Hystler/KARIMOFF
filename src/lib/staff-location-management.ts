import "server-only";

import type { TransactionSql } from "postgres";
import { getPhoneLookupCandidates } from "@/lib/phone";
import { getPostgresSql } from "@/lib/postgres/server";

export type StaffRole = "owner" | "admin" | "manager" | "cashier" | "cook";

export class StaffLocationAssignmentError extends Error {
  constructor(readonly reason: "location_required" | "invalid_location") {
    super(reason);
    this.name = "StaffLocationAssignmentError";
  }
}

export class DuplicateStaffPhoneError extends Error {
  constructor() {
    super("A staff account already uses this phone number.");
    this.name = "DuplicateStaffPhoneError";
  }
}

export function isStaffRole(value: string): value is StaffRole {
  return ["owner", "admin", "manager", "cashier", "cook"].includes(value);
}

export function staffRoleRequiresLocation(role: StaffRole) {
  return role === "manager" || role === "cashier" || role === "cook";
}

export function parseStaffLocationIds(values: readonly string[]) {
  const ids = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new StaffLocationAssignmentError("invalid_location");
  }
  return ids;
}

async function replaceStaffLocations(tx: TransactionSql, staffId: string, locationIds: string[]) {
  if (!locationIds.length) throw new StaffLocationAssignmentError("location_required");

  const locations = await tx<{ id: string; location_key: string }[]>`
    select id, location_key
    from public.order_locations
    where is_active and id = any(${locationIds}::uuid[])
    order by is_default desc, name
  `;
  if (locations.length !== locationIds.length) throw new StaffLocationAssignmentError("invalid_location");

  await tx`
    delete from public.staff_location_access
    where staff_id = ${staffId}::uuid and order_location_id is not null
  `;

  for (const location of locations) {
    await tx`
      insert into public.staff_location_access (staff_id, location_key, order_location_id)
      values (${staffId}::uuid, ${`order:location:${location.id}`}, ${location.id}::uuid)
      on conflict (staff_id, location_key) do update
      set order_location_id = excluded.order_location_id
    `;
  }
}

export async function createStaffAccount(params: {
  name: string;
  phone: string;
  passwordHash: string;
  role: StaffRole;
  locationIds: string[];
}) {
  if (staffRoleRequiresLocation(params.role) && !params.locationIds.length) {
    throw new StaffLocationAssignmentError("location_required");
  }

  const sql = getPostgresSql();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${params.phone}, 0))`;
    const [existing] = await tx<{ id: string }[]>`
      select id
      from public.staff_users
      where phone = any(${getPhoneLookupCandidates(params.phone)}::text[])
      limit 1
    `;
    if (existing) throw new DuplicateStaffPhoneError();

    const [staff] = await tx<{ id: string }[]>`
      insert into public.staff_users (name, phone, password_hash, role, is_active)
      values (${params.name}, ${params.phone}, ${params.passwordHash}, ${params.role}, true)
      returning id
    `;
    if (!staff) throw new Error("Staff account insert returned no row.");

    if (staffRoleRequiresLocation(params.role)) {
      await replaceStaffLocations(tx, staff.id, params.locationIds);
    }
    return String(staff.id);
  });
}

export async function updateStaffRoleAndLocations(params: {
  staffId: string;
  role: StaffRole;
  locationIds: string[];
}) {
  if (staffRoleRequiresLocation(params.role) && !params.locationIds.length) {
    throw new StaffLocationAssignmentError("location_required");
  }

  const sql = getPostgresSql();
  return sql.begin(async (tx) => {
    const [staff] = await tx<{ id: string }[]>`
      update public.staff_users
      set role = ${params.role}, updated_at = now()
      where id = ${params.staffId}::uuid
      returning id
    `;
    if (!staff) return false;

    if (staffRoleRequiresLocation(params.role)) {
      await replaceStaffLocations(tx, staff.id, params.locationIds);
    }
    return true;
  });
}
