import { Hero } from "@/components/Hero";
import { PopularMenu } from "@/components/PopularMenu";
import { getActiveProducts } from "@/lib/products";
import { getSiteSettings } from "@/lib/settings";

export default async function Home() {
  const [products, settings] = await Promise.all([getActiveProducts(100), getSiteSettings()]);

  return (
    <main>
      <Hero title={settings.hero_title} subtitle={settings.hero_subtitle} imageUrl={settings.home_hero_image_url} />
      <PopularMenu products={products} />
    </main>
  );
}
