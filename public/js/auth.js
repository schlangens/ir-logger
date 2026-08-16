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
    // A visitor who arrived via an invite link (register.html?invite=...)
    // carries that token along so the server can let this one
    // registration through even if REGISTRATION_OPEN=false (see
    // findValidInviteForEmail in src/routes/auth.js).
    const inviteToken = new URLSearchParams(window.location.search).get('invite');
    try {
      await post('/api/auth/register', {
        email: data.email,
        password: data.password,
        name: data.name,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
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

// Registration affordances — the "Start free" button on index.html, the
// "Create one" link on login.html, and the sign-up form itself on
// register.html — start hidden in the delivered HTML (`is-hidden`, same
// mechanism as the Google button above) so a closed instance never
// flashes a sign-up control that would 403 on submit. GET
// /api/auth/session reports `registration_open` (never *why* it's closed)
// so these can decide whether to reveal themselves; register.html also
// reveals a `#registration-closed-notice` in the opposite case.
//
// Failure stance: OPEN — the opposite of initGoogleSignIn's fail-closed
// stance. The Google button always has a working fallback (the
// email/password form), so hiding it on any check failure costs nothing.
// Sign-up has no fallback: on a fresh, zero-configuration clone it is the
// *only* way in, since nothing seeds an account. If this check can't get
// a definitive answer (network error, bad JSON), assuming the default —
// open — is the safe read: the real gate is enforced server-side in POST
// /api/auth/register regardless of what this page shows, so revealing the
// control when we couldn't confirm the state costs at most a 403 on
// submit on a genuinely closed instance, whereas hiding it when we
// couldn't confirm the state could strand a first-time visitor with no
// way in at all. A visitor arriving via an invite link (`?invite=` on
// register.html) always sees the working form regardless of this check —
// the server alone decides, on submit, whether their invite lets
// registration through on a closed instance (see auth.js's
// findValidInviteForEmail on the server).
export async function initRegistrationGate() {
  const gated = document.querySelectorAll('[data-registration-gated]');
  const closedNotice = document.getElementById('registration-closed-notice');
  if (!gated.length && !closedNotice) return;
  const reveal = () => gated.forEach((el) => el.classList.remove('is-hidden'));
  if (new URLSearchParams(window.location.search).has('invite')) {
    reveal();
    return;
  }
  try {
    const data = await get('/api/auth/session', undefined, { noRedirect: true });
    if (data && data.registration_open === false) {
      if (closedNotice) closedNotice.classList.remove('is-hidden');
      return;
    }
  } catch (err) {
    // Fail open — see comment above.
  }
  reveal();
}

// Reads the invite token from wherever it lives: the URL path for the
// shareable link the server actually generates (`/invite/<token>`, served
// by src/server.js), or the `?token=` query string as a fallback for a
// hand-typed or bookmarked variant.
function readInviteToken() {
  const prefix = '/invite/';
  if (window.location.pathname.startsWith(prefix)) {
    const raw = window.location.pathname.slice(prefix.length);
    if (raw) return decodeURIComponent(raw);
  }
  return new URLSearchParams(window.location.search).get('token') || '';
}

export async function initInvite(form) {
  const loading = document.querySelector('[data-loading]');
  const missingToken = document.querySelector('[data-missing-token]');
  const signinRequired = document.querySelector('[data-signin-required]');
  const registerLink = document.getElementById('invite-register-link');
  const token = readInviteToken();

  // A visitor without an account yet is sent to register.html carrying the
  // same token, so a closed instance still lets them create the one
  // account this invite entitles them to (see initRegistrationGate and
  // initRegister above).
  if (registerLink && token) {
    registerLink.href = `/register.html?invite=${encodeURIComponent(token)}`;
  }

  if (!token) {
    if (loading) loading.hidden = true;
    if (missingToken) missingToken.hidden = false;
    return;
  }

  // A stranger can land on this page with no session at all — submitting
  // the accept form in that state would 401 and get silently redirected to
  // /login.html by api.js, losing this exact link (and the token with it).
  // Check sign-in state up front instead, and point an unauthenticated
  // visitor at sign-in/registration first: they must still be able to
  // finish accepting even when this instance has closed public sign-ups,
  // which is exactly what register.html's invite-token handling exists
  // for (see initRegister/initRegistrationGate above).
  let signedIn = false;
  try {
    const session = await get('/api/auth/session', undefined, { noRedirect: true });
    signedIn = Boolean(session && session.user);
  } catch (err) {
    // Fail closed on this check: treat "couldn't tell" the same as "not
    // signed in" so the visitor gets the recovery message instead of a
    // form that's guaranteed to fail.
    signedIn = false;
  }

  if (loading) loading.hidden = true;

  if (!signedIn) {
    if (signinRequired) signinRequired.hidden = false;
    return;
  }

  if (!form) return;
  form.hidden = false;
  const error = form.querySelector('[data-error]');
  const success = form.querySelector('[data-success]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (error) error.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post(`/api/invites/${encodeURIComponent(token)}/accept`);
      if (success) success.hidden = false;
      setTimeout(() => { window.location.href = '/app/dashboard.html'; }, 1500);
    } catch (err) {
      if (error) { error.textContent = err.message || 'Could not accept invite.'; error.hidden = false; }
    } finally {
      submit.disabled = false;
    }
  });
}
