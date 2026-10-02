// Global settings and the model catalogue: data/config/settings.md and data/config/models.md.
export class ConfigRepo {
  constructor(store) {
    this.store = store;
  }

  async getSettings() {
    const doc = await this.store.readDoc(['config', 'settings.md']);
    return doc?.data ?? {};
  }

  async updateSettings(patch) {
    return this.store.updateDoc(['config', 'settings.md'], (doc) => ({
      data: { ...(doc?.data ?? {}), ...patch },
      body: doc?.body ?? '',
    }));
  }

  /** Models keyed by id (haiku | sonnet | opus | ...), in catalogue order. */
  async getModels() {
    const doc = await this.store.readDoc(['config', 'models.md']);
    return doc?.data?.models ?? {};
  }

  /** Read-modify-write of one model's entry in models.md. Returns the updated model, or null if unknown. */
  async updateModel(id, fn) {
    let result = null;
    await this.store.updateDoc(['config', 'models.md'], (doc) => {
      const current = doc?.data?.models?.[id];
      if (!current) return null;
      result = { ...current, ...fn(current) };
      return { data: { ...doc.data, models: { ...doc.data.models, [id]: result } }, body: doc.body };
    });
    return result;
  }

  /** Model id used to write memory after a task (cheap by default). */
  async getReflectionModelId() {
    const doc = await this.store.readDoc(['config', 'models.md']);
    return doc?.data?.reflection ?? 'haiku';
  }
}
