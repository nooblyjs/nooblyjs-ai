// RICE: reach × impact × confidence ÷ effort. Reach is in thousands of customers a quarter, impact 0.25–3,
// confidence 0–1 and effort in person-months `[CONFIRM the units your PMs use]`. The score is rounded to a whole number.

export const RICE_LIMITS = {
  reach: { min: 0, max: 1e6 },
  impact: { min: 0.25, max: 3 },
  confidence: { min: 0, max: 1 },
  effort: { min: 0.1, max: 1000 },
};

/** The problems with a set of RICE inputs, as { field: message }, or null when they're all fine. */
export function riceErrors(rice) {
  const errors = {};
  for (const [field, { min, max }] of Object.entries(RICE_LIMITS)) {
    const value = rice?.[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) errors[field] = `${field} must be a number`;
    else if (value < min || value > max) errors[field] = `${field} must be between ${min} and ${max}`;
  }
  return Object.keys(errors).length ? errors : null;
}

/** The score, or null when the inputs are incomplete. */
export function riceScore(rice) {
  if (riceErrors(rice)) return null;
  return Math.round((rice.reach * rice.impact * rice.confidence) / rice.effort);
}
