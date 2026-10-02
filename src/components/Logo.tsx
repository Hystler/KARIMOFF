import Link from "next/link";

type BrandWordmarkProps = {
  className?: string;
  decorative?: boolean;
  inverse?: boolean;
  size?: "sm" | "md" | "lg";
};

function PandaMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="inline-block h-[1.22em] w-[1.22em] flex-none align-[-0.13em]"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="18.5" cy="17.5" r="10.5" fill="#121214" />
      <circle cx="45.5" cy="17.5" r="10.5" fill="#121214" />
      <circle cx="32" cy="34" r="24.5" fill="#FFFFFF" />
      <path
        d="M9.8 42.6c8.4-5.4 20.3-.5 30.6-2.8 5.6-1.2 10.3-3.6 14.1-7.1A24.6 24.6 0 0 1 32 58.5 24.7 24.7 0 0 1 9.8 42.6Z"
        fill="#121214"
      />
      <ellipse cx="24.2" cy="29.8" rx="6.1" ry="7.8" fill="#121214" />
      <ellipse cx="39.8" cy="29.8" rx="6.1" ry="7.8" fill="#121214" />
      <path d="M28.7 38c0-1.9 1.4-3.1 3.3-3.1s3.3 1.2 3.3 3.1c0 1.6-1.5 2.9-3.3 2.9s-3.3-1.3-3.3-2.9Z" fill="#121214" />
      <path d="M24 43.2c2.2 3.5 5.4 5.1 8 5.1s5.8-1.6 8-5.1" fill="none" stroke="#121214" strokeWidth="3.7" strokeLinecap="round" />
    </svg>
  );
}

export function BrandWordmark({ className = "", decorative = false, inverse = false, size = "md" }: BrandWordmarkProps) {
  const sizeClass = size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl";

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "KARIMOFF"}
      aria-hidden={decorative ? true : undefined}
      className={`inline-flex items-center font-heading font-black leading-none ${sizeClass} ${inverse ? "text-white" : "text-karimoff-black"} ${className}`}
    >
      <span aria-hidden="true" className="inline-flex items-center">KARIM<PandaMark />FF</span>
    </span>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      prefetch={false}
      className="inline-flex min-h-11 items-center focus-visible:rounded-sm"
      aria-label="KARIMOFF — на главную"
    >
      <BrandWordmark decorative size="md" />
    </Link>
  );
}
