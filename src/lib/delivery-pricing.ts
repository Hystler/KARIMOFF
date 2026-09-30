export const DELIVERY_FEE_RUBLES = 200;
export const FREE_DELIVERY_THRESHOLD_RUBLES = 2_500;

export function calculateDeliveryFee(subtotal: number) {
  return subtotal >= FREE_DELIVERY_THRESHOLD_RUBLES ? 0 : DELIVERY_FEE_RUBLES;
}
