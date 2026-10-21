// CHG-009: Product and Design were sections of the Factory (/factory/product, /factory/design) and are apps of their
// own now (/product, /design). An old address lands on the same page there, with its query: the frame's redirects stay
// inside one app, so this page carries the address across.
export function render(view, { ctx, route }) {
  const from = `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}/${route?.meta?.from}`;
  const { pathname, search, hash } = window.location;
  const rest = pathname.startsWith(from) ? pathname.slice(from.length) : '';
  ctx.navigate(`/${route?.meta?.from}${rest}${search}${hash}`, { absolute: true, replace: true });
}
