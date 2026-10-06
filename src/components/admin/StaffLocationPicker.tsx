"use client";

import { useState } from "react";
import type { StaffRole } from "@/lib/staff-location-management";

export type StaffLocationOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

const roles: { value: StaffRole; label: string }[] = [
  { value: "cook", label: "Повар" },
  { value: "cashier", label: "Кассир" },
  { value: "manager", label: "Управляющий" },
  { value: "admin", label: "Администратор" },
  { value: "owner", label: "Владелец" }
];

function roleNeedsLocation(role: StaffRole) {
  return role === "cook" || role === "cashier" || role === "manager";
}

export function StaffLocationPicker({
  locations,
  initialRole = "cook",
  initialSelected = []
}: {
  locations: StaffLocationOption[];
  initialRole?: StaffRole;
  initialSelected?: string[];
}) {
  const [role, setRole] = useState<StaffRole>(initialRole);
  const [selected, setSelected] = useState<string[]>(initialSelected);

  return (
    <div className="contents">
      <label className="admin-field">Роль
        <select name="role" value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
          {roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {roleNeedsLocation(role) ? (
        <fieldset className="grid gap-2 rounded-lg border border-karimoff-line p-3 md:col-span-2">
          <legend className="px-1 text-sm font-semibold">Доступные точки</legend>
          {locations.length ? locations.map((location) => (
            <label key={location.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="location_id"
                value={location.id}
                checked={selected.includes(location.id)}
                onChange={(event) => setSelected((current) => event.target.checked
                  ? [...current, location.id]
                  : current.filter((id) => id !== location.id))}
                className="h-4 w-4 accent-karimoff-orange"
              />
              <span>{location.name}{location.isDefault ? " · основная" : ""}</span>
            </label>
          )) : <p className="text-sm text-karimoff-muted">Нет активных точек для назначения.</p>}
          <p className="text-xs text-karimoff-muted">Для этой роли нужно выбрать хотя бы одну точку.</p>
        </fieldset>
      ) : (
        <p className="self-end pb-2 text-sm text-karimoff-muted md:col-span-2">Полный доступ ко всем точкам.</p>
      )}
    </div>
  );
}
