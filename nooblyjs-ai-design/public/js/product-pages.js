// The Product app's pages shown in this app (Phase 16b; apps of their own since CHG-009): Architecture is Design's
// row, but its pages, API and stylesheet are Product's. Each page is drawn in an element scoped like Product's module
// (data-module="product", so product.css applies, which register() lists among this app's styles) with a ctx whose
// API client calls Product's API and whose links are built under Product's path. Navigation stays this app's: a page
// that moves to '/architecture/<id>' lands on /design/architecture/<id>.
export const PRODUCT_PATH = '/product';

/** The kit's API client. It is only there in the browser; tests pass their own. */
const kitApi = async () => (await import('/ui/js/api.js')).createApi;

/** The ctx a Product page gets: the frame's, with Product's API and Product's path for the links it builds. */
export function productContext(ctx, createApi) {
  return { ...ctx, app: { ...ctx.app, mountPath: PRODUCT_PATH }, api: createApi(`${PRODUCT_PATH}/api/v1`, { signal: ctx.signal }) };
}

/** One of Product's pages ('stage-list.js', 'architecture.js'), wrapped. `deps` ({ api, doc, load }) are for tests. */
export function productPage(file, { api = kitApi, doc = () => document, load = (url) => import(url) } = {}) {
  return async () => {
    const page = await load(`${PRODUCT_PATH}/js/pages/${file}`);
    return {
      async render(view, args) {
        const root = doc().createElement('div');
        root.dataset.module = 'product';
        root.className = 'design-product-page';
        view.append(root);
        return page.render(root, { ...args, ctx: productContext(args.ctx, await api()) });
      },
      destroy: () => page.destroy?.(),
    };
  };
}
