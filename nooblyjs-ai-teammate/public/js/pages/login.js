// Sign in (/login). Signing in happens on nooblyjs-core's login page, which brings you back here afterwards.
const SIGN_IN = '/services/authservice/views/login.html';
const safeReturn = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) && !next.startsWith('/login') ? next : '/team');

export async function render(view, { query, ctx }) {
  view.innerHTML = '<div class="auth-wrap"><p class="header-subtitle" role="status">Taking you to sign in…</p></div>';
  location.replace(`${ctx.session?.links?.signIn ?? SIGN_IN}?returnUrl=${encodeURIComponent(safeReturn(query.get('next')))}`);
}
