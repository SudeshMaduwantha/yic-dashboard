import { el, escapeHtml, escapeAttr, KNOWN_SPORTS } from './utils.js';
import { login, logout, watchAuth, createStaffAccount, getMyRole, claimSuperAdmin } from './firebase.js';
import { setCurrentRole } from './role-state.js';

export function initLoginUI({ onLogin, onLogout }) {
  el('staff-sport-checks').innerHTML = KNOWN_SPORTS.map((s) => `
    <label class="reg-sport-check">
      <input type="checkbox" value="${escapeAttr(s)}" />
      ${escapeHtml(s)}
    </label>
  `).join('');
  el('staff-role').addEventListener('change', (e) => {
    el('staff-sport-group').classList.toggle('hidden', e.target.value !== 'coach');
  });

  el('bootstrap-claim-btn').addEventListener('click', async () => {
    const btn = el('bootstrap-claim-btn');
    btn.disabled = true;
    btn.textContent = 'Claiming…';
    try {
      await claimSuperAdmin();
      location.reload();
    } catch (err) {
      el('bootstrap-error').textContent = err.message || 'Could not claim Super Admin.';
      btn.disabled = false;
      btn.textContent = 'Claim Super Admin';
    }
  });

  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el('login-email').value.trim();
    const password = el('login-password').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const errorEl = el('login-error');
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await login(email, password);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  el('signout-btn').addEventListener('click', () => logout());

  el('add-staff-btn').addEventListener('click', () => el('add-staff-modal').classList.remove('hidden'));
  el('add-staff-cancel').addEventListener('click', () => closeStaffModal());

  el('add-staff-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el('staff-email').value.trim();
    const password = el('staff-password').value;
    const role = el('staff-role').value;
    const sports = [...el('staff-sport-checks').querySelectorAll('input:checked')].map((c) => c.value);
    const errorEl = el('add-staff-error');
    const successEl = el('add-staff-success');
    errorEl.textContent = '';
    successEl.textContent = '';
    if (role === 'coach' && sports.length === 0) {
      errorEl.textContent = 'Pick at least one sport for this coach.';
      return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await createStaffAccount(email, password, role, sports);
      successEl.textContent = `Account created for ${email}.`;
      e.target.reset();
      el('staff-sport-group').classList.add('hidden');
      setTimeout(closeStaffModal, 1200);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
    } finally {
      btn.disabled = false;
    }
  });

  watchAuth(async (user) => {
    if (!user) {
      setCurrentRole(null);
      el('app-shell').classList.add('hidden');
      el('bootstrap-screen').classList.add('hidden');
      el('login-screen').classList.remove('hidden');
      onLogout();
      return;
    }

    const role = await getMyRole();
    if (!role) {
      // First-ever login with no role assigned yet — offer to self-claim Super Admin.
      el('login-screen').classList.add('hidden');
      el('app-shell').classList.add('hidden');
      el('bootstrap-screen').classList.remove('hidden');
      return;
    }

    role.uid = user.uid;
    setCurrentRole(role);
    el('login-screen').classList.add('hidden');
    el('bootstrap-screen').classList.add('hidden');
    el('app-shell').classList.remove('hidden');
    el('login-form').reset();
    onLogin(user, role);
  });
}

function closeStaffModal() {
  el('add-staff-modal').classList.add('hidden');
  el('add-staff-form').reset();
  el('add-staff-error').textContent = '';
  el('add-staff-success').textContent = '';
}

function friendlyAuthError(err) {
  const code = err && err.code;
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Incorrect email or password.';
  }
  if (code === 'auth/invalid-email') return 'That email address doesn\'t look right.';
  if (code === 'auth/too-many-requests') return 'Too many attempts — wait a bit and try again.';
  if (code === 'auth/email-already-in-use') return 'An account with that email already exists.';
  if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
  if (code === 'auth/configuration-not-found') return 'Email/Password sign-in isn\'t enabled in Firebase yet — see setup steps.';
  return err && err.message ? err.message : 'Sign-in failed.';
}
