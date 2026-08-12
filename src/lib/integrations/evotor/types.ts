import { z } from "zod";

export const evotorTokenDeliverySchema = z.object({
  userId: z.string().trim().min(1).max(160),
  token: z.string().trim().min(16).max(4096)
});

export const evotorInstallationEventSchema = z.object({
  id: z.string().trim().min(1).max(160),
  timestamp: z.union([z.number().int().nonnegative(), z.string().trim().min(1).max(80)]),
  version: z.number().int().positive(),
  type: z.enum(["ApplicationInstalled", "ApplicationUninstalled"]),
  data: z.object({
    productId: z.string().trim().min(1).max(160),
    userId: z.string().trim().min(1).max(160)
  })
});

export const evotorStoreSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  address: z.string().nullish(),
  user_id: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish()
}).passthrough();

export const evotorDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  store_id: z.string().nullish(),
  status: z.string().nullish(),
  timezone_offset: z.number().int().nullish(),
  firmware_version: z.string().nullish(),
  device_model: z.string().nullish()
}).passthrough();

export const evotorEmployeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  last_name: z.string().nullish(),
  patronymic_name: z.string().nullish(),
  stores: z.array(z.string()).nullish(),
  role: z.string().nullish(),
  role_id: z.string().nullish(),
  user_id: z.string().nullish()
}).passthrough();

export const evotorProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  code: z.string().nullish(),
  article_number: z.string().nullish(),
  bar_codes: z.array(z.string()).nullish(),
  barcodes: z.array(z.string()).nullish(),
  price: z.number().nullish(),
  cost_price: z.number().nullish(),
  measure_name: z.string().nullish(),
  tax: z.union([z.string(), z.number()]).nullish(),
  allow_to_sell: z.boolean().nullish(),
  is_removed: z.boolean().nullish(),
  isRemoved: z.boolean().nullish()
}).passthrough();

export const evotorDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  number: z.union([z.string(), z.number()]).nullish(),
  close_date: z.string().nullish(),
  device_id: z.string().nullish(),
  store_id: z.string().nullish(),
  employee_id: z.string().nullish(),
  close_user_id: z.string().nullish(),
  body: z.record(z.string(), z.unknown()).nullish()
}).passthrough();

export type EvotorTokenDelivery = z.infer<typeof evotorTokenDeliverySchema>;
export type EvotorInstallationEvent = z.infer<typeof evotorInstallationEventSchema>;
export type EvotorStore = z.infer<typeof evotorStoreSchema>;
export type EvotorDevice = z.infer<typeof evotorDeviceSchema>;
export type EvotorEmployee = z.infer<typeof evotorEmployeeSchema>;
export type EvotorProduct = z.infer<typeof evotorProductSchema>;
export type EvotorDocument = z.infer<typeof evotorDocumentSchema>;

export type EvotorReceiptItem = {
  sourceKey: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  tax: string | null;
  raw: Record<string, unknown>;
};

export type EvotorReceipt = {
  externalId: string;
  type: "sale" | "return" | "correction";
  number: string | null;
  employeeId: string | null;
  closedAt: string | null;
  subtotal: number;
  discount: number;
  total: number;
  payments: Array<{ type: string; sum: number }>;
  fiscalDocumentNumber: string | null;
  fiscalDriveNumber: string | null;
  fiscalSign: string | null;
  items: EvotorReceiptItem[];
  raw: Record<string, unknown>;
};

export type EvotorSyncCounts = {
  stores: number;
  devices: number;
  employees: number;
  products: number;
  documents: number;
  receipts: number;
};
