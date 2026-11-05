// Deployment capability ceiling. This never replaces staff/session authorization.
export type ProductEdition = "full" | "analytics";

export function getProductEdition(): ProductEdition {
  const value = process.env.KARIMOFF_EDITION;
  if (!value || value === "analytics") return "analytics";
  if (value === "full") return "full";
  throw new Error("Invalid KARIMOFF_EDITION; expected full or analytics.");
}

const analyticsPages = new Set([
  "/admin", "/admin/login", "/admin/products", "/admin/products/new",
  "/admin/ingredients/extras", "/admin/production", "/admin/production/new",
  "/admin/integrations/evotor", "/api/integrations/evotor/token",
  "/api/integrations/evotor/installation", "/api/internal/evotor/sync",
  "/api/terminal/pair", "/api/terminal/health", "/api/terminal/orders/next", "/admin/inventory", "/admin/inventory/movements",
  "/admin/ingredients", "/admin/ingredients/new", "/admin/ingredients/prices",
  "/admin/economics", "/admin/analytics", "/admin/analytics/sales",
  "/admin/analytics/audience", "/admin/analytics/planning",
  "/api/admin/analytics/performance", "/api/admin/analytics/report/export",
  "/api/admin/analytics/sales/export", "/api/health"
]);

export function isEditionPathAllowed(pathname: string, edition: ProductEdition) {
  if (edition === "full") return true;
  // Exact routes: newly added modules remain disabled until reviewed.
  return analyticsPages.has(pathname)
    || /^\/admin\/(?:ingredients|products|production)\/[0-9a-f-]{36}\/edit$/i.test(pathname)
    || /^\/api\/admin\/products\/[0-9a-f-]{36}\/images$/i.test(pathname);
}

export function assertEditionActionAllowed(capabilityPath: string) {
  // Use the action's own constant capability, never a request header/path supplied by the caller.
  if (!isEditionPathAllowed(capabilityPath, getProductEdition())) {
    throw new Error("This operation is unavailable in this product edition.");
  }
}

// One selected owner login in the cabinet. Existing full-product users are untouched.
// Without a selected staff ID, only the existing configured legacy owner can enter.
export function isEditionOwnerAllowed(staff: { id: string | null; role: string; legacy: boolean }) {
  if (getProductEdition() === "full") return true;
  const selectedId = process.env.KARIMOFF_OWNER_STAFF_ID;
  if (!selectedId) return staff.legacy;
  if (!/^[0-9a-f-]{36}$/i.test(selectedId)) return false;
  return !staff.legacy && staff.id === selectedId && ["owner", "admin"].includes(staff.role);
}
