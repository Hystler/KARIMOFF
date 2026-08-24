import { MaxMiniApp } from "@/components/auth/MaxMiniApp";
import { getMaxAuthConfig, logMaxAuthDiagnostics } from "@/lib/auth/social/config";

export const dynamic = "force-dynamic";

export default function MaxMiniAppPage() {
  logMaxAuthDiagnostics("mini_app");
  return <MaxMiniApp configured={Boolean(getMaxAuthConfig())} />;
}
