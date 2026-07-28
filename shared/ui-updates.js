import { el } from './utils.js';

function applyStatus(status) {
  const statusText = el('updates-status-text');
  const checkBtn = el('updates-check-btn');
  const installBtn = el('updates-install-btn');
  const progressWrap = el('updates-progress-wrap');
  const progressBar = el('updates-progress-bar');
  const badge = el('updates-badge');
  const notesWrap = el('updates-notes-wrap');
  const notesBody = el('updates-notes-body');

  progressWrap.classList.add('hidden');
  installBtn.classList.add('hidden');
  badge.classList.add('hidden');
  checkBtn.disabled = false;

  if (status.notes) {
    notesWrap.classList.remove('hidden');
    notesBody.textContent = status.notes;
  } else {
    notesWrap.classList.add('hidden');
    notesBody.textContent = '';
  }

  switch (status.state) {
    case 'checking':
      statusText.textContent = 'Checking for updates…';
      checkBtn.disabled = true;
      break;
    case 'available':
      statusText.textContent = `Update found — downloading v${status.version}…`;
      checkBtn.disabled = true;
      break;
    case 'downloading':
      statusText.textContent = `Downloading update… ${status.percent}%`;
      checkBtn.disabled = true;
      progressWrap.classList.remove('hidden');
      progressBar.style.width = `${status.percent}%`;
      break;
    case 'downloaded':
      statusText.textContent = `Update v${status.version} ready to install.`;
      installBtn.classList.remove('hidden');
      badge.classList.remove('hidden');
      break;
    case 'not-available':
      statusText.textContent = "You're on the latest version.";
      break;
    case 'dev':
      statusText.textContent = 'Updates only run in the installed app, not this dev build.';
      checkBtn.disabled = true;
      break;
    case 'error':
      statusText.textContent = `Update check failed: ${status.message}`;
      break;
    default:
      statusText.textContent = '—';
  }
}

// Desktop app only — window.api.updates only exists in the Electron build, not
// the website build (both are compiled from this same shared/ source). The
// sidebar section starts with the "hidden" class in index.html for exactly
// this reason; it only comes off here, once we know we're actually in Electron.
export function initUpdatesUI() {
  if (typeof window.api === 'undefined' || !window.api.updates) return;

  document.querySelector('.sidebar-section[data-section="updates"]').classList.remove('hidden');
  window.api.getAppVersion().then((v) => { el('updates-current-version').textContent = `v${v}`; });

  el('updates-check-btn').addEventListener('click', () => {
    applyStatus({ state: 'checking' });
    window.api.updates.check();
  });
  el('updates-install-btn').addEventListener('click', () => window.api.updates.install());

  window.api.updates.onStatus(applyStatus);
}
