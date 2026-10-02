const round1 = (x) => Math.round(x * 10) / 10;

export const cToF = (c) => round1((c * 9) / 5 + 32);
export const fToC = (f) => round1(((f - 32) * 5) / 9);
