import type { AnchorHTMLAttributes } from "react";

type AuthDocumentLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

export function AuthDocumentLink({ href, ...props }: AuthDocumentLinkProps) {
  // Auth routes carry their own document-level CSP and popup policy.
  return <a href={href} {...props} />;
}
