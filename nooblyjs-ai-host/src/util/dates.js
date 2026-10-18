// Times are ISO-8601 UTC strings. Day files use the UTC date.

/** The current time as an ISO string; `clock` can be replaced in tests. */
export const now = (clock = Date) => new Date(clock.now()).toISOString();

/** ['2026', '10', '2026-10-08.yaml'] for the day of `iso`. */
export function daySegments(iso) {
  const day = iso.slice(0, 10);
  return [day.slice(0, 4), day.slice(5, 7), `${day}.yaml`];
}
