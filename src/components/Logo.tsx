import Link from "next/link";

type LogoProps = {
  compact?: boolean;
};

function PandaMark() {
  return (
    <span className="relative mx-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#FFFFFF] p-[2px] align-middle shadow-[0_0_0_1px_rgba(18,18,20,0.12),0_4px_12px_rgba(18,18,20,0.12)] sm:h-8 sm:w-8">
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="18.5" cy="17.5" r="10.5" fill="#121214" />
        <circle cx="45.5" cy="17.5" r="10.5" fill="#121214" />
        <circle cx="32" cy="34" r="24.5" fill="#FFFFFF" stroke="#121214" strokeWidth="3.6" />
        <path
          d="M9.8 42.6c8.4-5.4 20.3-.5 30.6-2.8 5.6-1.2 10.3-3.6 14.1-7.1A24.6 24.6 0 0 1 32 58.5 24.7 24.7 0 0 1 9.8 42.6Z"
          fill="#121214"
        />
        <ellipse cx="24.2" cy="29.8" rx="6.1" ry="7.8" fill="#121214" />
        <ellipse cx="39.8" cy="29.8" rx="6.1" ry="7.8" fill="#121214" />
        <path d="M28.7 38c0-1.9 1.4-3.1 3.3-3.1s3.3 1.2 3.3 3.1c0 1.6-1.5 2.9-3.3 2.9s-3.3-1.3-3.3-2.9Z" fill="#121214" />
        <path
          d="M24 43.2c2.2 3.5 5.4 5.1 8 5.1s5.8-1.6 8-5.1"
          fill="none"
          stroke="#121214"
          strokeWidth="3.7"
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
