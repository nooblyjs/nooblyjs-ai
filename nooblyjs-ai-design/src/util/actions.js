// NooblyJS Phase 27: who may do what is configuration. Each check names an ACTION and the permission it needs by
// default; NooblyJS's access/roles.yaml (`actions:`) may give it another. On a host without actions (this app's own
// stand-in host), the default permission.

/** Middleware: the signed-in person may take `name` (its permission from roles.yaml, else `permission`). */
export const action = (host, name, permission) => (typeof host.requireAction === 'function' ? host.requireAction(name, permission) : host.requireRole(permission));

/** True when `accessRole` may take `name`. */
export async function canDo(host, accessRole, name, permission) {
  if (typeof host.canDo === 'function') return host.canDo(accessRole, name, permission);
  return Boolean(await host.can?.(accessRole, permission));
}

/** The permission `name` needs: roles.yaml's, else `permission`. */
export async function permissionFor(host, name, permission) {
  return typeof host.permissionFor === 'function' ? host.permissionFor(name, permission) : permission;
}
