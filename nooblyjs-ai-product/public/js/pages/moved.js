// A page that lives in another app now. Architecture is shown in the Design app (Phase 16b, CHG-009), so
// /product/architecture/<id> lands on /design/architecture/<id>, keeping its id. The frame's redirects stay inside
// one app, so this page carries the address across.
export function render(view, { params, ctx, route }) {
  const to = route?.meta?.to ?? '/';
  ctx.navigate(params?.id ? `${to}/${encodeURIComponent(params.id)}` : to, { absolute: true, replace: true });
}
