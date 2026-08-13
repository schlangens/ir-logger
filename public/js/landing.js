import { post } from './api.js';
import { h, loading, errorBox } from './ui.js';

export async function initLanding(container) {
  const demoBtn = container.querySelector('[data-demo]');
  if (!demoBtn) return;
  demoBtn.addEventListener('click', async () => {
    demoBtn.disabled = true;
    const status = container.querySelector('[data-demo-status]');
    if (status) status.innerHTML = '';
    try {
      const data = await post('/api/demo');
      if (data.incident_id) {
        if (data.workspace_id) localStorage.setItem('ir-logger-workspace', data.workspace_id);
        window.location.href = `/app/incident.html?id=${encodeURIComponent(data.incident_id)}`;
      } else {
        throw new Error('Demo did not return an incident.');
      }
    } catch (err) {
      const el = errorBox(err.message || 'Could not start demo.');
      if (status) status.append(el);
      else container.append(el);
      demoBtn.disabled = false;
    }
  });
}
