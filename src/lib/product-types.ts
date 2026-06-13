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
};
