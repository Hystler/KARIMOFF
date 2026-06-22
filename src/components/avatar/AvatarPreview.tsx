import type { AvatarConfig } from "@/lib/avatar-schema";

type AvatarPreviewProps = {
  avatar: AvatarConfig;
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  sm: "h-24 w-24",
  md: "h-40 w-40",
  lg: "h-64 w-64"
};

const backgroundClasses: Record<string, string> = {
  orange: "bg-[radial-gradient(circle_at_28%_22%,#FFD7BE_0%,#FB670A_55%,#D95405_100%)]",
  black: "bg-[radial-gradient(circle_at_30%_20%,#34343A_0%,#121214_68%)]",
  grill: "bg-[linear-gradient(135deg,#121214_0_18%,#FB670A_18%_20%,#1B1B1F_20%_48%,#FB670A_48%_50%,#121214_50%_100%)]",
  clean: "bg-[linear-gradient(145deg,#FFFFFF_0%,#F8F4EE_100%)]",
  neon: "bg-[radial-gradient(circle_at_30%_20%,rgba(251,103,10,0.65)_0%,#121214_58%,#050506_100%)]"
};

export function AvatarPreview({ avatar, size = "md" }: AvatarPreviewProps) {
  const isSmall = size === "sm";
  const backgroundClass = backgroundClasses[avatar.background] ?? backgroundClasses.orange;
  const isRoundBase = avatar.base === "panda_round";
  const isStrictBase = avatar.base === "panda_strict";

  return (
    <div className={`${sizeClasses[size]} relative overflow-hidden rounded-[28%] border border-karimoff-line ${backgroundClass} shadow-[0_24px_70px_rgba(18,18,20,0.16)]`}>
      <svg viewBox="0 0 220 220" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {avatar.background === "grill" || avatar.background === "neon" ? (
          <g opacity="0.18" stroke="#fff" strokeWidth="3">
            <path d="M34 168h152M42 150h136M52 132h116" />
          </g>
        ) : null}

        {avatar.clothes === "hoodie_black" || avatar.clothes === "black_hoodie" ? (
          <path d="M55 190c9-38 32-55 55-55s46 17 55 55H55Z" fill="#121214" />
        ) : avatar.clothes === "apron_orange" || avatar.clothes === "orange_apron" ? (
          <path d="M62 192c8-39 28-58 48-58s40 19 48 58H62Z" fill="#FB670A" />
        ) : avatar.clothes === "black_apron" ? (
          <path d="M62 192c8-39 28-58 48-58s40 19 48 58H62Z" fill="#121214" />
        ) : null}

        <circle cx="66" cy="61" r="27" fill="#09090A" />
        <circle cx="154" cy="61" r="27" fill="#09090A" />
        <circle cx="110" cy="102" r={isRoundBase ? "76" : "72"} fill="#FFFFFF" stroke="#09090A" strokeWidth={isStrictBase ? "8" : "7"} />
        <path d={isStrictBase ? "M39 132c30 16 76 24 142 4-8 39-34 63-71 63-33 0-59-20-71-67Z" : "M41 134c28 22 73 31 138 8-7 35-33 57-69 57-32 0-58-19-69-65Z"} fill="#09090A" opacity="0.98" />

        {avatar.eyes === "happy" ? (
          <g stroke="#09090A" strokeLinecap="round" strokeWidth="8">
            <path d="M76 94c8 8 20 8 28 0" />
            <path d="M116 94c8 8 20 8 28 0" />
          </g>
        ) : avatar.eyes === "sleepy" ? (
          <g stroke="#09090A" strokeLinecap="round" strokeWidth="8">
            <path d="M73 94c10-3 22-3 32 0" />
            <path d="M115 94c10-3 22-3 32 0" />
          </g>
        ) : avatar.eyes === "serious" ? (
          <g fill="#09090A">
            <ellipse cx="88" cy="93" rx="16" ry="22" transform="rotate(-12 88 93)" />
            <ellipse cx="132" cy="93" rx="16" ry="22" transform="rotate(12 132 93)" />
            <path d="M72 71h30v8H72zM118 71h30v8h-30z" />
          </g>
        ) : (
          <g fill="#09090A">
            <ellipse cx="88" cy="94" rx="17" ry="23" />
            <ellipse cx="132" cy="94" rx="17" ry="23" />
          </g>
        )}

        <path d="M105 120c3-6 7-8 12-8s9 2 12 8c-3 5-7 7-12 7s-9-2-12-7Z" fill="#09090A" />
        {avatar.mouth === "smile" ? (
          <path d="M91 132c12 15 40 15 52 0" fill="none" stroke="#09090A" strokeLinecap="round" strokeWidth="7" />
        ) : avatar.mouth === "grin" ? (
          <path d="M92 132c12 20 39 20 51 0" fill="#FFFFFF" stroke="#09090A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
        ) : (
          <path d="M98 136h38" fill="none" stroke="#09090A" strokeLinecap="round" strokeWidth="7" />
        )}

        {avatar.accessory === "cap_orange" || avatar.accessory === "orange_cap" || avatar.accessory === "black_cap" ? (
          <g>
            <path d="M61 55c14-27 81-31 103 0-27-8-73-8-103 0Z" fill={avatar.accessory === "black_cap" ? "#121214" : "#FB670A"} stroke="#09090A" strokeWidth="5" />
            <path d="M134 55c20 0 37 5 48 15-22 2-40-2-55-10Z" fill={avatar.accessory === "black_cap" ? "#121214" : "#FB670A"} stroke="#09090A" strokeWidth="5" />
          </g>
        ) : null}
        {avatar.accessory === "sunglasses" ? (
          <g fill="#09090A">
            <rect x="67" y="83" width="41" height="24" rx="9" />
            <rect x="112" y="83" width="41" height="24" rx="9" />
            <path d="M105 93h10v6h-10z" />
          </g>
        ) : null}
        {avatar.accessory === "burger" || avatar.accessory === "burger_pin" ? (
          <g transform="translate(145 142)">
            <path d="M0 19c2-14 14-21 29-21 14 0 27 7 29 21H0Z" fill="#F7B267" stroke="#09090A" strokeWidth="4" />
            <path d="M1 22h56" stroke="#FB670A" strokeWidth="8" />
            <path d="M4 31h50" stroke="#09090A" strokeWidth="8" />
            <path d="M6 41h46" stroke="#F7B267" strokeWidth="9" />
          </g>
        ) : null}
      </svg>
      {!isSmall ? (
        <div className="absolute bottom-3 left-3 right-3 rounded-full border border-white/35 bg-white/20 px-3 py-1 text-center text-xs font-black uppercase tracking-[0.14em] text-white backdrop-blur-sm">
          KARIMOFF
        </div>
      ) : null}
    </div>
  );
}
