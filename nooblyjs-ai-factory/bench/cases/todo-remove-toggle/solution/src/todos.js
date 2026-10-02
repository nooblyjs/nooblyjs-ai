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

  remove(id) {
    const before = this.#items.length;
    this.#items = this.#items.filter((i) => i.id !== id);
    return this.#items.length < before;
  }

  toggle(id) {
    const item = this.#items.find((i) => i.id === id);
    if (!item) throw new RangeError(`No todo ${id}`);
    item.done = !item.done;
    return item.done;
  }
}
