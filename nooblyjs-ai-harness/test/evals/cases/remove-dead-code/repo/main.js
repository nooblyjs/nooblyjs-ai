import { daysBetween, formatDate } from './utils.js';

const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-03-01T00:00:00Z');
console.log(`${formatDate(start)} → ${formatDate(end)}: ${daysBetween(start, end)} days`);
