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
  fallbackImageUrl = "/assets/hero/rustam-package.webp?v=09b580ad0927",
  imageUrl,
  objectPosition = "center",
  subtitle,
  title
}: PageHeroProps) {
  const src = imageUrl || fallbackImageUrl;

  return (
    <section className="relative isolate mt-[68px] w-full overflow-hidden bg-karimoff-black text-white sm:mt-[74px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={2400}
        height={1200}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        style={{ objectPosition }}
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(18,18,20,0.82)_0%,rgba(18,18,20,0.58)_48%,rgba(18,18,20,0.30)_100%),linear-gradient(180deg,rgba(18,18,20,0.15)_0%,rgba(18,18,20,0.50)_100%)]" />
      <div className="container-page flex min-h-[300px] items-center py-9 sm:min-h-[370px] sm:py-14">
        <div className="min-w-0 max-w-[720px]">
          <p className="text-sm font-bold text-karimoff-orange">{eyebrow}</p>
          <h1 className="mt-3 text-balance text-[clamp(2rem,5vw,3.6rem)] font-black leading-[1.06] sm:mt-4 sm:leading-[1.02]">
            {title}
          </h1>
          <p className="mt-4 max-w-[620px] text-base font-medium leading-7 text-white/88 sm:mt-5 sm:text-lg sm:leading-8">
            {subtitle}
          </p>
          {ctaHref && ctaLabel ? (
            <Link
              href={ctaHref}
              className="public-button-primary mt-6 w-full sm:mt-7 sm:w-auto"
            >
              {ctaLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
