import { post, get } from './api.js';
import { h, toast, errorBox } from './ui.js';

function collectForm(form) {
  const data = {};
  for (const el of form.elements) {
    if (el.name) data[el.name] = el.value;
  }
  return data;
}

export function initLogin(form) {
  if (!form) return;
  const error = form.querySelector('[data-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (error) error.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post('/api/auth/login', collectForm(form));
      window.location.href = '/app/dashboard.html';
    } catch (err) {
      if (error) { error.textContent = err.message || 'Sign in failed.'; error.hidden = false; }
    } finally {
      submit.disabled = false;
    }
  });
}

export function initRegister(form) {
  if (!form) return;
  const error = form.querySelector('[data-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (error) error.hidden = true;
    const data = collectForm(form);
    if (data.password !== data.password_confirm) {
      if (error) { error.textContent = 'Passwords do not match.'; error.hidden = false; }
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post('/api/auth/register', {
        email: data.email,
        password: data.password,
        name: data.name,
      });
      window.location.href = '/app/dashboard.html';
    } catch (err) {
      if (error) { error.textContent = err.message || 'Registration failed.'; error.hidden = false; }
    } finally {
      submit.disabled = false;
    }
  });
}

// The "Continue with Google" button and its divider start hidden in the
// HTML (`is-hidden`, not the `hidden` attribute — both elements set their
// own `display` in components.css, which an author-stylesheet rule always
// wins over the `[hidden]` UA rule, so `hidden` alone would not actually
// hide them). This reveals both together, or neither, so there's never a
// dangling "or" divider with no button under it.
//
// Fail-closed stance: if the availability check itself errors (network
// failure, non-2xx, bad JSON), the elements are left hidden rather than
// shown. The email/password form above is always present and always
// works, so hiding is the safe failure — showing a Google button that
// might not actually be wired up (a dead link) is the failure this fix
// exists to prevent in the first place.
export async function initGoogleSignIn() {
  const divider = document.getElementById('google-divider');
  const button = document.getElementById('google-signin');
  if (!divider || !button) return;
  try {
    const data = await get('/api/auth/session', undefined, { noRedirect: true });
    if (data && data.google_enabled) {
      divider.classList.remove('is-hidden');
      button.classList.remove('is-hidden');
    }
  } catch (err) {
    // Fail closed: leave both hidden.
  }
}

export function initInvite(form) {
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const error = form.querySelector('[data-error]');
  const success = form.querySelector('[data-success]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (error) error.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = await post(`/api/invites/${encodeURIComponent(token)}/accept`);
      if (success) success.hidden = false;
      setTimeout(() => { window.location.href = '/app/dashboard.html'; }, 1500);
    } catch (err) {
      if (error) { error.textContent = err.message || 'Could not accept invite.'; error.hidden = false; }
    } finally {
      submit.disabled = false;
    }
  });
}
