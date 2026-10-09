export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.STAGING_UI_MODE === "true") return;
  const { startEvotorBackgroundScheduler } = await import(
    "@/lib/integrations/evotor/scheduler"
  );
  const { startYooKassaBackgroundScheduler } = await import(
    "@/lib/payments/yookassa/scheduler"
  );
  const { startOrderNotificationScheduler } = await import(
    "@/lib/notifications/order-status/scheduler"
  );
  startEvotorBackgroundScheduler();
  startYooKassaBackgroundScheduler();
  startOrderNotificationScheduler();
}
