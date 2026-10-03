import { NextResponse } from "next/server";
import { getDefaultDeliveryLocationId } from "@/lib/delivery/address-whitelist";
import { getPostgresSql } from "@/lib/postgres/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const locationId = await getDefaultDeliveryLocationId();
    if (!locationId) return NextResponse.json({ error: "Address data is unavailable." }, { status: 503 });
    const sql = getPostgresSql();
    const addresses = await sql<{
      city: string | null;
      street: string;
      house: string;
      building: string;
      latitude: number;
      longitude: number;
      distance_meters: number;
      source_id: string | null;
      source_snapshot_version: string | null;
    }[]>`
      select city, street, house, building, latitude, longitude, distance_meters,
        source_id, source_snapshot_version
      from public.delivery_addresses
      where location_id = ${locationId}::uuid and source = 'openstreetmap'
      order by street_normalized, house_normalized, building_normalized
    `;
    const version = addresses.map((address) => address.source_snapshot_version).find(Boolean) ?? null;
    return NextResponse.json({
      attribution: "© OpenStreetMap contributors",
      source: "OpenStreetMap",
      snapshot_version: version,
      license: "Open Database License 1.0 (ODbL)",
      license_url: "https://opendatacommons.org/licenses/odbl/1-0/",
      addresses
    }, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Content-Disposition": "attachment; filename=karimoff-openstreetmap-delivery-addresses.json"
      }
    });
  } catch {
    return NextResponse.json({ error: "Address data is unavailable." }, { status: 503 });
  }
}
