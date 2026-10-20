// A page that moved (Phase 16b): Architecture is the Design section's now, so an old /factory/product/architecture/<id>
// link lands on /factory/design/architecture/<id>, keeping its id. The frame's redirects are static paths, so this
// page carries the parameter across.
export function render(view, { params, ctx, route }) {
  const to = route?.meta?.to ?? '/';
  ctx.navigate(params?.id ? `${to}/${encodeURIComponent(params.id)}` : to, { replace: true });
}
