// A page that moved within the Factory: an old /factory/engineering/test-analysis/<id> link (Test analysis is the Test
// section's since Phase 16d) lands on /factory/quality/test-analysis/<id>, keeping its id. The frame's redirects are
// static paths, so this page carries the parameter across.
export function render(view, { params, ctx, route }) {
  const to = route?.meta?.to ?? '/';
  ctx.navigate(params?.id ? `${to}/${encodeURIComponent(params.id)}` : to, { replace: true });
}
