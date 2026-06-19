import { BrandSection } from "@/components/BrandSection";
import { BusinessSection } from "@/components/BusinessSection";
import { CareersTeaser } from "@/components/CareersTeaser";
import { Directions } from "@/components/Directions";
import { FAQ } from "@/components/FAQ";
import { FranchiseTeaser } from "@/components/FranchiseTeaser";
import { Hero } from "@/components/Hero";
import { LeadForm } from "@/components/LeadForm";
import { PopularMenu } from "@/components/PopularMenu";
import { getActiveProducts } from "@/lib/products";
import { getSiteSettings } from "@/lib/settings";

export default async function Home() {
  const [products, settings] = await Promise.all([getActiveProducts(4), getSiteSettings()]);

  return (
    <main>
      <Hero title={settings.hero_title} subtitle={settings.hero_subtitle} />
      <PopularMenu products={products} />
      <BrandSection />
      <Directions />
      <BusinessSection />
      <FranchiseTeaser />
      <CareersTeaser />
      <FAQ />
      <LeadForm />
    </main>
  );
}
