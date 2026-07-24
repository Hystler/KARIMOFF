import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalDocuments, legalSlugs } from "@/lib/legal-content";

export function generateStaticParams() {
  return legalSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = legalDocuments[slug];

  return document
    ? { title: `${document.title} | KARIMOFF`, description: document.subtitle }
    : {};
}

export default async function LegalDocumentPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const document = legalDocuments[slug];

  if (!document) {
    notFound();
  }

  return <LegalPage document={document} />;
}
