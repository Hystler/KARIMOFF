export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startEvotorBackgroundScheduler } = await import(
    "@/lib/integrations/evotor/scheduler"
  );
  startEvotorBackgroundScheduler();
}
