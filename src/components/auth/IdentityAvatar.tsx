type IdentityAvatarProps = {
  identityId: string;
  label: string;
  hasImage: boolean;
};

export function IdentityAvatar({ identityId, label, hasImage }: IdentityAvatarProps) {
  if (hasImage) {
    return (
      // Provider images are served through a same-origin, authenticated allowlist proxy.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/auth/avatar?identity=${encodeURIComponent(identityId)}`}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 rounded-full border border-karimoff-line bg-karimoff-soft object-cover"
      />
    );
  }
  return (
    <span aria-hidden="true" className="flex h-10 min-w-10 items-center justify-center rounded-full bg-karimoff-black px-2 text-xs font-black text-white">
      {label}
    </span>
  );
}
