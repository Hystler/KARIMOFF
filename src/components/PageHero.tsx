import Link from "next/link";

type PageHeroProps = {
  ctaHref?: string;
  ctaLabel?: string;
  eyebrow: string;
  fallbackImageUrl?: string;
  imageUrl?: string | null;
  objectPosition?: string;
  subtitle: string;
  title: string;
};

export function PageHero({
  ctaHref,
  ctaLabel,
  eyebrow,
  fallbackImageUrl = "/assets/hero/rustam-package.jpg",
  imageUrl,
  objectPosition = "center",
  subtitle,
  title
}: PageHeroProps) {
  const src = imageUrl || fallbackImageUrl;

  return (
    <section className="relative isolate w-full overflow-hidden bg-karimoff-black pt-[68px] text-white sm:pt-[74px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        style={{ objectPosition }}
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(18,18,20,0.82)_0%,rgba(18,18,20,0.58)_48%,rgba(18,18,20,0.30)_100%),linear-gradient(180deg,rgba(18,18,20,0.15)_0%,rgba(18,18,20,0.50)_100%)]" />
      <div className="container-page flex min-h-[330px] items-center py-12 sm:min-h-[390px] sm:py-16">
        <div className="max-w-[760px]">
          <p className="text-sm font-bold text-karimoff-orange">{eyebrow}</p>
          <h1 className="mt-4 text-balance text-[clamp(2.15rem,5vw,4.35rem)] font-black leading-[0.98]">
            {title}
          </h1>
          <p className="mt-5 max-w-[640px] text-base font-medium leading-7 text-white/82 sm:text-lg sm:leading-8">
            {subtitle}
          </p>
          {ctaHref && ctaLabel ? (
            <Link
              href={ctaHref}
              className="mt-7 inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.24)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
            >
              {ctaLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

