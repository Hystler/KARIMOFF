export type ProductImage = {
  id: string;
  product_id: string;
  created_at?: string;
  image_url: string;
  alt: string | null;
  sort_order: number;
  is_primary: boolean;
};

export type ProductModifierOption = {
  ingredient_id: string;
  name: string;
  unit: "g" | "ml" | "pcs";
  base_quantity: number;
  is_removable: boolean;
  is_extra_available: boolean;
  extra_quantity: number;
  extra_price: number;
  max_extra_quantity: number;
  sort_order: number;
};

export type Product = {
  id: string;
  created_at?: string;
  updated_at?: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  weight?: string | null;
  tags?: string[] | null;
  calories?: number | null;
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
  allergens?: string[] | null;
  images?: ProductImage[];
  modifier_options?: ProductModifierOption[];
};
