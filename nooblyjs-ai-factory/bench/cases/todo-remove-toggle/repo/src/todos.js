export class TodoStore {
  #items = [];
  #next = 1;

  add(text) {
    const item = { id: this.#next++, text, done: false };
    this.#items.push(item);
    return item.id;
  }

  list() {
    return this.#items.map((i) => ({ ...i }));
  }
}
