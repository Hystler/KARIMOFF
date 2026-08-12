import "server-only";

import { getCurrentStaff } from "@/lib/admin-auth";
import { getPostgresSql } from "@/lib/postgres/server";
import type { AnalyticsScope } from "./types";

export class AnalyticsAccessError extends Error {
  constructor(message = "Недостаточно прав для просмотра аналитики.") {
    super(message);
    this.name = "AnalyticsAccessError";
  }
}
export async function getAnalyticsScope(): Promise<AnalyticsScope> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role === "cook") throw new AnalyticsAccessError();

  if (staff.legacy) {
    return { role: "owner", locationIds: null, cacheKey: "owner:all" };
  }

  if (staff.role === "admin") {
    return { role: "admin", locationIds: null, cacheKey: `admin:${staff.id ?? "all"}` };
  }

  if (!staff.id) throw new AnalyticsAccessError();

  const sql = getPostgresSql();
  try {
    const rows = await sql<{ location_key: string }[]>`
      select location_key
      from public.staff_location_access
      where staff_id = ${staff.id}::uuid
      order by location_key
    `;
    const locationIds = rows.map((row) => row.location_key);
    return {
      role: "manager",
      locationIds,
      cacheKey: `manager:${staff.id}:${locationIds.join(",") || "none"}`
    };
  } catch {
    // A manager is denied by default until the scoped-access migration is applied.
    return { role: "manager", locationIds: [], cacheKey: `manager:${staff.id}:none` };
  }
}
