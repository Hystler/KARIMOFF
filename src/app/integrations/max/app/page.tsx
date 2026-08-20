import { MaxMiniApp } from "@/components/auth/MaxMiniApp";
import { getMaxAuthConfig } from "@/lib/auth/social/config";

export const dynamic = "force-dynamic";

export default function MaxMiniAppPage() {
  return <MaxMiniApp configured={Boolean(getMaxAuthConfig())} />;
}
