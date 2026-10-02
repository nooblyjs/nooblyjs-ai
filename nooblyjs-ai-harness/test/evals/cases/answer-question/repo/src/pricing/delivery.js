import { rates } from './rates.js';

// The cost of sending an order: base rate by country plus a per-kilogram charge.
export function computeFreightCharge(order) {
  const rate = rates[order.country] ?? rates.default;
  return rate.base + rate.perKg * order.weightKg;
}

export function priceWithDelivery(order) {
  return order.subtotal + computeFreightCharge(order);
}
