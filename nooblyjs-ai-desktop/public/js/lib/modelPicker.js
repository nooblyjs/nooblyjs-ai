// Keeps the model <select> showing only models belonging to the chosen provider.
export function wireModelPicker(container, { onChange } = {}) {
  if (!container) return null;
  const providerSelect = container.querySelector('[data-provider-select]');
  const modelSelect = container.querySelector('[data-model-select]');
  if (!providerSelect || !modelSelect) return null;

  const allOptions = [...modelSelect.options].map((o) => ({
    value: o.value,
    label: o.textContent,
    provider: o.dataset.provider
  }));

  function syncModels(preferred) {
    const provider = providerSelect.value;
    const matching = provider ? allOptions.filter((o) => o.provider === provider) : [];

    modelSelect.replaceChildren();
    if (matching.length === 0) {
      const opt = new Option(provider ? 'No models' : 'Inherit default', '');
      modelSelect.append(opt);
      modelSelect.disabled = true;
      return;
    }
    modelSelect.disabled = false;
    for (const o of matching) modelSelect.append(new Option(o.label, o.value));
    if (preferred && matching.some((o) => o.value === preferred)) modelSelect.value = preferred;
  }

  const initialModel = modelSelect.value;
  syncModels(initialModel);

  providerSelect.addEventListener('change', () => {
    syncModels(null);
    onChange?.(value());
  });
  modelSelect.addEventListener('change', () => onChange?.(value()));

  function value() {
    return { provider: providerSelect.value || null, model: modelSelect.value || null };
  }

  return { value, providerSelect, modelSelect };
}
