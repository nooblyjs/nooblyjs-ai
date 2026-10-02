import { priceWithDelivery } from '../pricing/delivery.js';

export function checkout(order) {
  return { ...order, total: priceWithDelivery(order) };
}
