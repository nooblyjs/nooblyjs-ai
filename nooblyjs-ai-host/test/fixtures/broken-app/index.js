// A hosted app whose register() fails, to prove NooblyJS starts without it (roadmap Phase 0 step 10).
export async function register() {
  throw new Error('broken-app fails on purpose (test fixture)');
}
