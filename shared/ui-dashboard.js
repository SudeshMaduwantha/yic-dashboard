import { Chart, BarController, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { el, escapeHtml, escapeAttr, formatMonthLabel, allMonthKeys, presentTotalForMonths, SPORT_LOGOS, KNOWN_SPORTS } from './utils.js';
import { getCurrentRole, isCoach, isSuperAdmin, isAdministrator } from './role-state.js';
import { updateStudentInfo, renameStudentInFees, getStudentMeta, setStudentMeta, syncPublicProfile, setSportCoach } from './firebase.js';

function canManageStudents() { return isSuperAdmin() || isAdministrator(); }

Chart.register(BarController, CategoryScale, LinearScale, BarElement);

let attendanceChart = null;
let allStudents = [];
let allFees = [];
let feesLoaded = false; // stays false for roles (coach) that never receive fee data at all
let allCoaches = [];
const filters = { sport: 'all', grade: 'all', month: 'all', search: '' };

export function initDashboardUI() {
  el('sport-filter').addEventListener('change', (e) => { filters.sport = e.target.value; render(); syncSportStripActive(); });
  el('grade-filter').addEventListener('change', (e) => { filters.grade = e.target.value; render(); });
  el('month-filter').addEventListener('change', (e) => { filters.month = e.target.value; render(); });
  el('search-input').addEventListener('input', (e) => { filters.search = e.target.value.trim().toLowerCase(); render(); });
  el('student-filter').addEventListener('change', renderStudentSummary);
  el('student-manage-save').addEventListener('click', () => saveStudentChanges(false));
  el('student-manage-sync').addEventListener('click', () => saveStudentChanges(true));
}

export function updateDashboardData(students) {
  allStudents = students;
  populateFilterOptions();
  render();
  renderStudentSummary();
}

export function updateDashboardFees(fees) {
  allFees = fees;
  feesLoaded = true;
  renderStudentSummary();
}

export function updateCoaches(coaches) {
  allCoaches = coaches;
  renderCoachesPanel();
}

function renderCoachesPanel() {
  const sports = isCoach() ? getCurrentRole().sports : KNOWN_SPORTS;
  const canEdit = isSuperAdmin();
  el('coaches-table-body').innerHTML = sports.map((sport) => {
    const coach = allCoaches.find((c) => c.sport === sport) || {};
    if (canEdit) {
      return `
        <tr data-sport="${escapeAttr(sport)}">
          <td>${escapeHtml(sport)}</td>
          <td><input class="coach-input coach-name" type="text" value="${escapeAttr(coach.name || '')}" placeholder="—" /></td>
          <td><input class="coach-input coach-phone" type="tel" value="${escapeAttr(coach.phone || '')}" placeholder="—" /></td>
          <td><button type="button" class="connect-btn coach-save-btn">Save</button></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${escapeHtml(sport)}</td>
        <td>${escapeHtml(coach.name || '—')}</td>
        <td>${escapeHtml(coach.phone || '—')}</td>
        <td></td>
      </tr>
    `;
  }).join('');

  if (canEdit) {
    el('coaches-table-body').querySelectorAll('.coach-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const sport = row.dataset.sport;
        const name = row.querySelector('.coach-name').value.trim();
        const phone = row.querySelector('.coach-phone').value.trim();
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await setSportCoach(sport, { name, phone });
          btn.textContent = 'Saved ✓';
          setTimeout(() => { btn.textContent = 'Save'; }, 1500);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
}

function populateFilterOptions() {
  const sports = [...new Set(allStudents.map((s) => s.sport))].sort();
  const grades = [...new Set(allStudents.map((s) => s.grade).filter(Boolean))].sort();
  const months = allMonthKeys(allStudents);
  const names = [...new Set(allStudents.map((s) => s.name))].sort();

  syncSelectOptions(el('sport-filter'), sports, 'All sports', (s) => s);
  syncSelectOptions(el('grade-filter'), grades, 'All grades', (g) => `Grade ${g}`);
  syncSelectOptions(el('month-filter'), months, 'All months', formatMonthLabel);

  const studentSelect = el('student-filter');
  const prevStudent = studentSelect.value;
  studentSelect.innerHTML = '<option value="">Pick a student…</option>' +
    names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
  studentSelect.value = names.includes(prevStudent) ? prevStudent : '';

  // Coaches only ever see their own sport(s); everyone else sees all known sports,
  // even ones with zero students registered yet.
  renderSportStrip(isCoach() ? getCurrentRole().sports : KNOWN_SPORTS);
}

function renderStudentSummary() {
  const name = el('student-filter').value;
  const panel = el('student-summary-panel');
  el('student-manage-status').textContent = '';
  el('student-manage-error').textContent = '';
  if (!name) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const registrations = allStudents.filter((s) => s.name === name);
  const grade = registrations.find((s) => s.grade)?.grade;
  const studentCode = registrations.find((s) => s.studentCode)?.studentCode || '';
  const phone = registrations.find((s) => s.phone)?.phone || '';
  el('student-summary-title').textContent = `${name}${grade ? ` · Grade ${grade}` : ''}${studentCode ? ` · ${studentCode}` : ''}`;
  el('student-summary-contact').textContent = phone ? `📱 ${phone}` : '';

  el('student-summary-sports').innerHTML = registrations.map((s) => {
    const pt = presentTotalForMonths(s.months, 'all');
    const pct = pt.total ? Math.round((pt.present / pt.total) * 100) : 0;
    return `
      <div class="mini-sport-card">
        <div class="mini-sport-name">${escapeHtml(s.sport)}</div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="pct">${pt.present}/${pt.total} weeks · ${pct}%</div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Not registered for any sport.</div>';

  const manageSection = el('student-manage-section');
  manageSection.classList.toggle('hidden', !canManageStudents());
  if (canManageStudents()) {
    el('student-manage-name').value = name;
    el('student-manage-grade').value = grade || '';
    el('student-manage-phone').value = phone;
    el('student-manage-id').value = studentCode;
    el('student-manage-pin').value = '';
    if (studentCode) {
      getStudentMeta(studentCode).then((meta) => {
        // Only apply if the student filter hasn't changed while this was in flight.
        if (el('student-filter').value === name && meta && meta.pin) el('student-manage-pin').value = meta.pin;
      });
    }
  }

  if (!feesLoaded) {
    // Fees data unavailable for this role (e.g. coach) — skip the section entirely.
    el('student-summary-fees').innerHTML = '';
    el('student-summary-fee-table').classList.add('hidden');
    return;
  }
  const records = allFees.filter((f) => f.studentName === name);
  const totalDue = records.filter((f) => f.status === 'due').reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const totalPaid = records.filter((f) => f.status === 'paid').reduce((sum, f) => sum + Number(f.amount || 0), 0);
  el('student-summary-fees').innerHTML = `
    <div class="fee-summary-pill ${totalDue > 0 ? 'due' : 'clear'}">Total Due: Rs. ${totalDue.toLocaleString()}</div>
    <div class="fee-summary-pill paid">Total Paid: Rs. ${totalPaid.toLocaleString()}</div>
  `;

  const feeTable = el('student-summary-fee-table');
  if (records.length === 0) {
    feeTable.classList.add('hidden');
  } else {
    feeTable.classList.remove('hidden');
    const sorted = [...records].sort((a, b) => (b.month || '').localeCompare(a.month || ''));
    el('student-summary-fee-body').innerHTML = sorted.map((r) => `
      <tr>
        <td>${escapeHtml(r.sport)}</td>
        <td>${escapeHtml(r.month)}</td>
        <td>Rs. ${Number(r.amount).toLocaleString()}</td>
        <td><span class="status-pill ${r.status}">${r.status === 'paid' ? 'Paid' : 'Due'}</span></td>
      </tr>
    `).join('');
  }
}

async function saveStudentChanges(alsoSync) {
  const originalName = el('student-filter').value;
  if (!originalName) return;
  const newName = el('student-manage-name').value.trim();
  const newGrade = el('student-manage-grade').value.trim();
  const newPhone = el('student-manage-phone').value.trim();
  const code = el('student-manage-id').value.trim();
  const pin = el('student-manage-pin').value.trim();
  const statusEl = el('student-manage-status');
  const errorEl = el('student-manage-error');
  statusEl.textContent = '';
  errorEl.textContent = '';
  if (!newName) { errorEl.textContent = 'Name can\'t be empty.'; return; }
  if (!code) { errorEl.textContent = 'Enter a Student ID first.'; return; }

  const registrations = allStudents.filter((s) => s.name === originalName);
  const saveBtn = el('student-manage-save');
  const syncBtn = el('student-manage-sync');
  saveBtn.disabled = true;
  syncBtn.disabled = true;
  try {
    const ids = registrations.map((s) => s.id);
    await updateStudentInfo(ids, { name: newName, grade: newGrade, studentCode: code, phone: newPhone });
    if (newName !== originalName) await renameStudentInFees(ids, newName);
    if (pin) await setStudentMeta(code, { pin, name: newName });

    // Reflect the change immediately rather than waiting on the next snapshot round-trip.
    registrations.forEach((s) => {
      s.name = newName; s.grade = newGrade || null; s.studentCode = code || null; s.phone = newPhone || null;
    });
    if (newName !== originalName) {
      const sel = el('student-filter');
      if (![...sel.options].some((o) => o.value === newName)) {
        const opt = document.createElement('option');
        opt.value = newName;
        opt.textContent = newName;
        sel.appendChild(opt);
      }
      sel.value = newName;
    }
    statusEl.textContent = 'Saved.';

    if (alsoSync) {
      if (!pin) { errorEl.textContent = 'Set a PIN before syncing.'; return; }
      const sports = registrations.map((s) => {
        const pt = presentTotalForMonths(s.months, 'all');
        return { sport: s.sport, present: pt.present, total: pt.total, pct: pt.total ? Math.round((pt.present / pt.total) * 100) : 0 };
      });
      const feeRecords = allFees.filter((f) => f.studentName === newName)
        .map((f) => ({ sport: f.sport, month: f.month, amount: f.amount, status: f.status }));
      await syncPublicProfile(code, { name: newName, grade: newGrade || null, sports, feeRecords });
      statusEl.textContent = `Synced — parents can look up "${newName}" with ID ${code} and their PIN.`;
    }
    renderStudentSummary();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
    syncBtn.disabled = false;
  }
}

function renderSportStrip(sports) {
  const allBadge = `
    <div class="sport-badge all-badge${filters.sport === 'all' ? ' active' : ''}" data-sport="all">
      <div class="sport-badge-label">All Sports</div>
    </div>`;
  const badges = sports.map((sport) => {
    const logo = SPORT_LOGOS[sport];
    const active = filters.sport === sport ? ' active' : '';
    return logo
      ? `<div class="sport-badge${active}" data-sport="${escapeAttr(sport)}"><img src="${logo}" alt="${escapeAttr(sport)} logo" /></div>`
      : `<div class="sport-badge${active}" data-sport="${escapeAttr(sport)}"><div class="sport-badge-label">${escapeHtml(sport)}</div></div>`;
  }).join('');

  el('sport-strip').innerHTML = allBadge + badges;
  el('sport-strip').querySelectorAll('.sport-badge').forEach((badge) => {
    badge.addEventListener('click', () => {
      filters.sport = badge.dataset.sport;
      el('sport-filter').value = filters.sport;
      render();
      syncSportStripActive();
    });
  });
}

function syncSportStripActive() {
  el('sport-strip').querySelectorAll('.sport-badge').forEach((b) => {
    b.classList.toggle('active', b.dataset.sport === filters.sport);
  });
}

function syncSelectOptions(selectEl, values, allLabel, labelFn) {
  const prev = selectEl.value || 'all';
  selectEl.innerHTML = `<option value="all">${allLabel}</option>` +
    values.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(labelFn(v))}</option>`).join('');
  selectEl.value = values.includes(prev) ? prev : 'all';
}

function getFlatRoster() {
  return allStudents
    .filter((s) => filters.sport === 'all' || s.sport === filters.sport)
    .filter((s) => filters.grade === 'all' || String(s.grade) === filters.grade)
    .filter((s) => !filters.search
      || s.name.toLowerCase().includes(filters.search)
      || (s.studentCode || '').toLowerCase().includes(filters.search))
    .map((s) => ({ ...s, ...presentTotalForMonths(s.months, filters.month) }));
}

function render() {
  renderStats();
  renderRoster();
  renderAttendanceTable();
  renderChart();
}

function renderStats() {
  const roster = getFlatRoster();
  const totalPresent = roster.reduce((sum, r) => sum + r.present, 0);
  const totalMarked = roster.reduce((sum, r) => sum + r.total, 0);
  const avgAttendance = totalMarked ? Math.round((totalPresent / totalMarked) * 100) : 0;
  const perfectAttendance = roster.filter((r) => r.total > 0 && r.present === r.total).length;

  const stats = [
    { label: 'Students shown', value: roster.length },
    { label: 'Sports', value: new Set(allStudents.map((s) => s.sport)).size },
    { label: 'Avg. attendance', value: `${avgAttendance}%` },
    { label: 'Perfect attendance', value: perfectAttendance },
  ];
  el('stats-grid').innerHTML = stats.map((s) => `
    <div class="stat-card"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>
  `).join('');
}

function renderRoster() {
  const roster = getFlatRoster();
  const container = el('roster-cards');
  if (roster.length === 0) {
    container.innerHTML = '<div class="empty-state">No students match the current filters.</div>';
    return;
  }
  container.innerHTML = roster.map((r) => {
    const pct = r.total ? Math.round((r.present / r.total) * 100) : 0;
    return `
      <div class="roster-card">
        <div class="name">${escapeHtml(r.name)}${r.studentCode ? ` <span class="student-code-tag">${escapeHtml(r.studentCode)}</span>` : ''}</div>
        <div class="meta">Grade ${escapeHtml(String(r.grade || '—'))} · ${escapeHtml(r.sport)}</div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="pct">${r.present}/${r.total} weeks · ${pct}%</div>
      </div>
    `;
  }).join('');
}

function renderAttendanceTable() {
  const roster = getFlatRoster();
  const head = el('attendance-table-head');
  const body = el('attendance-table-body');

  if (filters.month === 'all') {
    const months = allMonthKeys(allStudents);
    head.innerHTML = `<tr><th>Name</th><th>Grade</th><th>Sport</th>${months.map((m) => `<th>${escapeHtml(formatMonthLabel(m))}</th>`).join('')}<th>Overall</th></tr>`;
    if (roster.length === 0) {
      body.innerHTML = `<tr><td colspan="${4 + months.length}" class="empty-state">No students match the current filters.</td></tr>`;
      return;
    }
    body.innerHTML = roster.map((r) => {
      const cells = months.map((m) => {
        const pt = presentTotalForMonths(r.months, m);
        return `<td>${pt.total ? `${pt.present}/${pt.total}` : '—'}</td>`;
      }).join('');
      return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(String(r.grade || '—'))}</td><td>${escapeHtml(r.sport)}</td>${cells}<td>${r.present}/${r.total}</td></tr>`;
    }).join('');
    return;
  }

  head.innerHTML = `<tr><th>Name</th><th>Grade</th><th>Sport</th><th>1st Week</th><th>2nd Week</th><th>3rd Week</th><th>4th Week</th><th>Present / Total</th></tr>`;
  if (roster.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">No students match the current filters.</td></tr>';
    return;
  }
  body.innerHTML = roster.map((r) => {
    const weeks = (r.months || {})[filters.month] || {};
    const weekCells = ['1st', '2nd', '3rd', '4th'].map((w) => {
      const v = weeks[w];
      const cls = v === true ? 'present' : v === false ? 'absent' : 'unmarked';
      const symbol = v === true ? '✓' : v === false ? '✕' : '–';
      return `<td><span class="mark ${cls}">${symbol}</span></td>`;
    }).join('');
    return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(String(r.grade || '—'))}</td><td>${escapeHtml(r.sport)}</td>${weekCells}<td>${r.present}/${r.total}</td></tr>`;
  }).join('');
}

function renderChart() {
  const sports = [...new Set(allStudents.map((s) => s.sport))].sort();
  const labels = [];
  const data = [];
  sports.forEach((sport) => {
    let present = 0, total = 0;
    allStudents.filter((s) => s.sport === sport).forEach((s) => {
      const pt = presentTotalForMonths(s.months, filters.month);
      present += pt.present;
      total += pt.total;
    });
    labels.push(sport);
    data.push(total ? Math.round((present / total) * 100) : 0);
  });

  const ctx = el('attendance-chart').getContext('2d');
  if (attendanceChart) attendanceChart.destroy();
  attendanceChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Attendance %', data, backgroundColor: '#f5941f', borderRadius: 6 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { color: '#8b93a7' }, grid: { color: '#272c3a' } },
        x: { ticks: { color: '#8b93a7' }, grid: { display: false } },
      },
    },
  });
}
