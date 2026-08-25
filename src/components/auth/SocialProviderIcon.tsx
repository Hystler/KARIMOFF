type SocialProviderIconProps = {
  provider: "phone" | "telegram" | "max";
  className?: string;
};

export function SocialProviderIcon({ provider, className = "h-5 w-5" }: SocialProviderIconProps) {
  if (provider === "telegram") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M20.7 4.2 17.9 18c-.2 1-.8 1.2-1.6.7l-4.3-3.2-2.1 2c-.2.2-.4.4-.8.4l.3-4.4 8-7.2c.4-.3-.1-.5-.5-.2L7 12.3l-4.3-1.4c-.9-.3-.9-.9.2-1.4l16.8-6.4c.8-.3 1.4.2 1 1.1Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (provider === "max") {
    return (
      <span
        aria-hidden="true"
        className={`inline-block shrink-0 bg-current ${className}`}
        style={{
          maskImage: "url('/assets/brand/max-mark.svg')",
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
          WebkitMaskImage: "url('/assets/brand/max-mark.svg')",
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain"
        }}
      />
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.2 3.5h2.7l1.4 4.2-1.8 1.5a15 15 0 0 0 5.3 5.3l1.5-1.8 4.2 1.4v2.7a3.7 3.7 0 0 1-3.7 3.7A13.3 13.3 0 0 1 3.5 7.2a3.7 3.7 0 0 1 3.7-3.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
