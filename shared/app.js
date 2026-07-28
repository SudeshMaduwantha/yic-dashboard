import { el, ROLE_LABELS, confirmDialog } from './utils.js';
import { watchStudents, watchFees, watchSportCoaches, watchSportFees, watchStaff, importStudent } from './firebase.js';
import { initLoginUI } from './ui-login.js';
import { initDashboardUI, updateDashboardData, updateDashboardFees, updateCoaches, updateStaffList, resetDashboardUI } from './ui-dashboard.js';
import { initAttendanceUI, updateAttendanceData, updateAttendanceFees } from './ui-attendance.js';
import { initFeesUI, updateFeesStudentData, updateFeesData, updateSportFees } from './ui-fees.js';
import { initUpdatesUI } from './ui-updates.js';

let unsubStudents = null;
let unsubFees = null;
let unsubCoaches = null;
let unsubSportFees = null;
let unsubStaff = null;
let latestStudents = [];

// ---------------- Sidebar version (desktop app only — window.api only exists there) ----------------
if (typeof window.api !== 'undefined' && window.api.getAppVersion) {
  window.api.getAppVersion().then((version) => {
    el('sidebar-version').textContent = `v${version}`;
    el('sidebar-version').classList.remove('hidden');
  });
}

// ---------------- Custom titlebar (desktop app only — window.api only exists there) ----------------
if (typeof window.api !== 'undefined' && window.api.windowControls) {
  el('custom-titlebar').classList.remove('hidden');
  const { windowControls } = window.api;

  el('win-min').addEventListener('click', () => windowControls.minimize());
  el('win-max').addEventListener('click', () => windowControls.toggleMaximize());
  el('win-close').addEventListener('click', async () => {
    const confirmed = await confirmDialog('Are you sure you want to close YIC Sport School?', { title: 'Close app?', okLabel: 'Close' });
    if (confirmed) windowControls.close();
  });

  const maxIcon = el('win-max').querySelector('svg');
  const setMaxIcon = (isMax) => {
    maxIcon.innerHTML = isMax
      ? '<rect x="3" y="1.5" width="6" height="6" stroke="currentColor" stroke-width="1.1" fill="none"/><rect x="1.5" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.1" fill="none"/>'
      : '<rect x="2.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1.2" fill="none"/>';
  };
  windowControls.isMaximized().then(setMaxIcon);
  windowControls.onMaximizeState(setMaxIcon);
}

// ---------------- Profile menu ----------------
el('profile-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  el('profile-btn').closest('.profile-menu').classList.toggle('open');
  el('profile-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const menu = el('profile-btn').closest('.profile-menu');
  if (!menu.contains(e.target)) {
    menu.classList.remove('open');
    el('profile-dropdown').classList.add('hidden');
  }
});

function roleLabel(role) {
  if (role.role === 'coach') return `Coach — ${(role.sports || []).join(', ') || 'no sport assigned'}`;
  return ROLE_LABELS[role.role] || role.role;
}

// ---------------- Sidebar navigation (sections + sub-tabs) ----------------
// Each top-level sidebar section expands into its own set of sub-tabs, replacing
// the old single-level tab bar so long pages (esp. Dashboard) split into smaller,
// independently-scrollable chunks instead of one long stack.
const SECTIONS = {
  dashboard: ['dashboard-overview', 'dashboard-attendance-table', 'dashboard-student-profile', 'dashboard-staff-coaches'],
  attendance: ['attendance-register', 'attendance-mark'],
  fees: ['fees-add', 'fees-ledger', 'fees-report'],
  updates: ['updates-main'],
};

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-subitem').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.sidebar-section-btn').forEach((b) => b.classList.remove('active'));
  el(`tab-${tabId}`).classList.add('active');
  const subitem = document.querySelector(`.sidebar-subitem[data-tab="${tabId}"]`);
  if (subitem) {
    subitem.classList.add('active');
    subitem.closest('.sidebar-section').querySelector('.sidebar-section-btn').classList.add('active');
  }
}

document.querySelectorAll('.sidebar-section-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(SECTIONS[btn.dataset.sectionBtn][0]));
});
document.querySelectorAll('.sidebar-subitem').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Sections each role is allowed to see. Super Admin sees everything.
const TAB_ACCESS = {
  super_admin: ['dashboard', 'attendance', 'fees'],
  administrator: ['dashboard', 'fees'],
  coach: ['dashboard', 'attendance'],
};

function applyRoleUI(role) {
  const allowedSections = TAB_ACCESS[role.role] || [];

  document.querySelectorAll('.sidebar-section').forEach((section) => {
    // "updates" isn't role-gated — it's available to every logged-in role, and its
    // visibility is instead controlled by ui-updates.js (desktop app vs. web build).
    if (section.dataset.section === 'updates') return;
    section.classList.toggle('hidden', !allowedSections.includes(section.dataset.section));
  });
  // If the currently active section isn't allowed for this role, jump to the first allowed one.
  const activeSubitem = document.querySelector('.sidebar-subitem.active');
  const activeSection = activeSubitem ? activeSubitem.closest('.sidebar-section').dataset.section : null;
  if (!activeSection || !allowedSections.includes(activeSection)) {
    switchTab(SECTIONS[allowedSections[0]][0]);
  }

  el('add-staff-btn').classList.toggle('hidden', role.role !== 'super_admin');
  if (typeof window.api !== 'undefined') {
    el('import-excel-btn').classList.toggle('hidden', role.role !== 'super_admin');
  }

  el('profile-email').textContent = role.email || '';
  el('profile-dropdown-email').textContent = role.email || '';
  el('profile-dropdown-role').textContent = roleLabel(role);
}

initLoginUI({
  onLogin: (user, role) => {
    applyRoleUI(role);
    const sportScope = role.role === 'coach' ? role.sports : undefined;
    unsubStudents = watchStudents((students) => {
      latestStudents = students;
      updateDashboardData(students);
      updateAttendanceData(students);
      updateFeesStudentData(students);
    }, sportScope);
    if (role.role === 'super_admin' || role.role === 'administrator') {
      unsubFees = watchFees((fees) => { updateFeesData(fees); updateDashboardFees(fees); updateAttendanceFees(fees); });
      unsubSportFees = watchSportFees((fees) => updateSportFees(fees));
    } else if (role.role === 'coach') {
      // Coaches get fee records for their own sport(s) too (for the Student Profile's
      // paid/unpaid status), but the amount is never rendered for them — same rule as
      // the Attendance tab's fee pill, enforced client-side in ui-dashboard.js.
      unsubFees = watchFees((fees) => { updateDashboardFees(fees); updateAttendanceFees(fees); }, role.sports);
    }
    unsubCoaches = watchSportCoaches((coaches) => updateCoaches(coaches));
    if (role.role === 'super_admin') {
      unsubStaff = watchStaff((staff) => updateStaffList(staff));
    }
  },
  onLogout: () => {
    if (unsubStudents) unsubStudents();
    if (unsubFees) unsubFees();
    if (unsubCoaches) unsubCoaches();
    if (unsubStaff) unsubStaff();
    if (unsubSportFees) unsubSportFees();
    unsubStudents = null;
    unsubFees = null;
    unsubCoaches = null;
    unsubStaff = null;
    unsubSportFees = null;
    latestStudents = [];
    resetDashboardUI();
  },
});

initDashboardUI();
initAttendanceUI();
initFeesUI();
initUpdatesUI();

// ---------------- Desktop-only: one-time Excel import ----------------
// Note: window.prompt()/alert() aren't reliably supported in Electron's renderer,
// so this uses a real form (import-year-modal) instead of a JS prompt dialog.
const isElectron = typeof window.api !== 'undefined';
if (isElectron) {
  const MONTH_NUMBERS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
  let pendingParsedData = null;

  el('import-excel-btn').classList.remove('hidden');

  el('import-excel-btn').addEventListener('click', async () => {
    const btn = el('import-excel-btn');
    btn.disabled = true;
    btn.textContent = 'Opening file…';
    try {
      const parsed = await window.api.chooseAndParseExcel();
      if (!parsed) return;
      pendingParsedData = parsed;
      el('import-year').value = String(new Date().getFullYear());
      el('import-error').textContent = '';
      el('import-status').textContent = '';
      el('import-year-modal').classList.remove('hidden');
    } catch (err) {
      el('import-error').textContent = err.message;
      el('import-year-modal').classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = '📥 Import from Excel';
    }
  });

  el('import-year-cancel').addEventListener('click', () => {
    pendingParsedData = null;
    el('import-year-modal').classList.add('hidden');
  });

  el('import-year-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingParsedData) { el('import-year-modal').classList.add('hidden'); return; }
    const year = parseInt(el('import-year').value, 10);
    if (!year) return;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    el('import-error').textContent = '';

    let count = 0;
    const failures = [];
    const total = Object.values(pendingParsedData).reduce((sum, arr) => sum + arr.length, 0);

    for (const [sport, students] of Object.entries(pendingParsedData)) {
      for (const s of students) {
        try {
          const months = {};
          (s.months || []).forEach((m) => {
            const num = MONTH_NUMBERS[m.name];
            if (!num) return;
            const key = `${year}-${String(num).padStart(2, '0')}`;
            const weeks = {};
            m.weeks.forEach((w) => { if (w.marked) weeks[w.label] = w.present; });
            if (Object.keys(weeks).length) months[key] = weeks;
          });
          await importStudent({ name: s.name, grade: s.grade, sport, months });
          count++;
        } catch (err) {
          console.error('Import failed for', s.name, sport, err);
          failures.push(`${s.name} (${sport}): ${err.message}`);
        }
        el('import-status').textContent = `Imported ${count}/${total}${failures.length ? `, ${failures.length} failed` : ''}…`;
      }
    }

    pendingParsedData = null;
    submitBtn.disabled = false;

    if (failures.length === 0) {
      el('import-status').textContent = `Done — imported ${count} of ${total} student record(s).`;
      setTimeout(() => el('import-year-modal').classList.add('hidden'), 1500);
    } else {
      el('import-status').textContent = `Imported ${count} of ${total}. ${failures.length} failed — see below.`;
      el('import-error').textContent = failures.slice(0, 5).join(' | ') + (failures.length > 5 ? ` (+${failures.length - 5} more)` : '');
    }
  });
}
