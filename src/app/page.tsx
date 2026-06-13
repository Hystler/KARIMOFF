import { BrandSection } from "@/components/BrandSection";
import { BusinessSection } from "@/components/BusinessSection";
import { CareersTeaser } from "@/components/CareersTeaser";
import { Directions } from "@/components/Directions";
import { FAQ } from "@/components/FAQ";
import { FranchiseTeaser } from "@/components/FranchiseTeaser";
import { Hero } from "@/components/Hero";
import { LeadForm } from "@/components/LeadForm";
import { PopularMenu } from "@/components/PopularMenu";

export default function Home() {
  return (
    <main>
      <Hero />
      <PopularMenu />
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
