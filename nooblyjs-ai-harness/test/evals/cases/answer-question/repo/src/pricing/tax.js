// Value-added tax. (Not shipping.)
export function calculateTax(amount, country) {
  return country === 'NL' ? amount * 0.21 : 0;
}
