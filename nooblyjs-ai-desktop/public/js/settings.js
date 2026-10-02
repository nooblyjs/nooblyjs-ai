import { api, showFormError } from './lib/api.js';
import { wireModelPicker } from './lib/modelPicker.js';

const form = document.getElementById('settings-form');
const status = document.getElementById('settings-status');
const picker = wireModelPicker(document.querySelector('[data-model-picker]'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFormError(form, '');
  status.textContent = 'Saving…';

  const { provider, model } = picker ? picker.value() : { provider: null, model: null };
  const data = new FormData(form);

  try {
    await api('PATCH', '/api/settings', {
      defaultProvider: provider,
      defaultModel: model,
      temperature: Number(data.get('temperature')),
      maxOutputTokens: Number(data.get('maxOutputTokens'))
    });
    status.textContent = 'Saved';
  } catch (err) {
    status.textContent = '';
    showFormError(form, err.message);
  }
});
