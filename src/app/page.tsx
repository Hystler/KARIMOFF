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

export default async function Home() {
  const products = await getActiveProducts(4);

  return (
    <main>
      <Hero />
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
