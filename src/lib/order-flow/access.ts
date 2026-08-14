import "server-only";

import type { CurrentStaff } from "@/lib/admin-auth";
import { getPostgresSql } from "@/lib/postgres/server";
import { getOrderLocations } from "./queries";
import type { OrderLocation } from "./types";

export async function getAccessibleOrderLocations(
  staff: CurrentStaff
): Promise<OrderLocation[]> {
  const locations = await getOrderLocations();
  if (staff.legacy || staff.role === "owner" || staff.role === "admin") return locations;
  if (!staff.id) return [];

  const sql = getPostgresSql();
  try {
    const rows = await sql<{ order_location_id: string }[]>`
      select order_location_id
      from public.staff_location_access
      where staff_id = ${staff.id}::uuid
        and order_location_id is not null
      order by created_at
    `;
    const allowed = new Set(rows.map((row) => row.order_location_id));
    return locations.filter((location) => allowed.has(location.id));
  } catch {
    return [];
  }
}

export async function canStaffAccessOrderLocation(
  staff: CurrentStaff,
  locationId: string
) {
  if (staff.legacy || staff.role === "owner" || staff.role === "admin") return true;
  const locations = await getAccessibleOrderLocations(staff);
  return locations.some((location) => location.id === locationId);
}

export async function canStaffAccessOrder(staff: CurrentStaff, orderId: string) {
  if (staff.legacy || staff.role === "owner" || staff.role === "admin") return true;
  if (!staff.id) return false;
  const sql = getPostgresSql();
  const rows = await sql<{ allowed: boolean }[]>`
    select exists (
      select 1
      from public.orders order_row
      join public.staff_location_access access
        on access.order_location_id = order_row.location_id
       and access.staff_id = ${staff.id}::uuid
      where order_row.id = ${orderId}::uuid
    ) as allowed
  `;
  return Boolean(rows[0]?.allowed);
}
