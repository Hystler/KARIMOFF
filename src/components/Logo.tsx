import Link from "next/link";

type LogoProps = {
  compact?: boolean;
};

function PandaMark() {
  return (
    <span className="relative mx-0.5 inline-flex h-7 w-7 items-center justify-center align-middle sm:h-8 sm:w-8">
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="18.5" cy="16.5" r="10.5" fill="#121214" />
        <circle cx="45.5" cy="16.5" r="10.5" fill="#121214" />
        <circle cx="32" cy="34" r="25" fill="#FFFFFF" stroke="#121214" strokeWidth="3.8" />
        <path
          d="M8.8 42.5C18.2 36.1 31.3 42.1 42.1 39.7c5.2-1.1 9.5-3.3 13.1-6.5A25.1 25.1 0 0 1 32 59 25 25 0 0 1 8.8 42.5Z"
          fill="#121214"
        />
        <ellipse cx="24" cy="29.5" rx="6.2" ry="8.2" fill="#121214" />
        <ellipse cx="40" cy="29.5" rx="6.2" ry="8.2" fill="#121214" />
        <path d="M28.5 38.1c0-2 1.5-3.4 3.5-3.4s3.5 1.4 3.5 3.4c0 1.8-1.6 3.2-3.5 3.2s-3.5-1.4-3.5-3.2Z" fill="#121214" />
        <path
          d="M22.8 42.2c2.5 4.1 6.1 6.1 9.2 6.1s6.7-2 9.2-6.1"
          fill="none"
          stroke="#121214"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Logo({ compact = false }: LogoProps) {
  return (
    <Link href="/" className="group inline-flex items-center gap-3" aria-label="KARIMOFF Бургерная">
      <span className="flex items-center font-heading text-[1.05rem] font-black text-karimoff-black sm:text-xl">
        KARIM
        <PandaMark />
        FF
      </span>
      {!compact ? (
        <span className="hidden border-l border-karimoff-line pl-3 text-xs font-bold text-karimoff-muted sm:block">
          БУРГЕРНАЯ
        </span>
      ) : null}
    </Link>
  );
}
