import { el, escapeHtml, escapeAttr, KNOWN_SPORTS, monthRange } from './utils.js';
import { addFee, updateFee, deleteFee } from './firebase.js';
import { isSuperAdmin, isAdministrator } from './role-state.js';

let allStudents = [];
let allFees = [];
let editingId = null;
const filters = { sport: 'all', student: 'all', status: 'all' };

function canManageFees() { return isSuperAdmin() || isAdministrator(); }

export function initFeesUI() {
  el('fee-sport').addEventListener('change', populateFeeStudentSelect);

  el('fee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = el('fee-student').value;
    const student = allStudents.find((s) => s.id === studentId);
    if (!student) return;
    const base = {
      studentId,
      studentName: student.name,
      sport: student.sport,
      amount: Number(el('fee-amount').value),
      status: el('fee-status').value,
    };
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      if (editingId) {
        await updateFee(editingId, { ...base, month: el('fee-month').value });
      } else {
        // Paying several months at once (e.g. "To month" set) creates one record per month.
        const months = monthRange(el('fee-month').value, el('fee-month-to').value);
        for (const month of months) {
          await addFee({ ...base, month });
        }
      }
      cancelEditFee();
      populateFeeStudentSelect();
    } finally {
      btn.disabled = false;
    }
  });

  el('fee-form-cancel').addEventListener('click', cancelEditFee);

  el('fee-filter-sport').addEventListener('change', (e) => { filters.sport = e.target.value; renderFeeFilterStudents(); renderFeesTable(); });
  el('fee-filter-student').addEventListener('change', (e) => { filters.student = e.target.value; renderFeesTable(); });
  el('fee-filter-status').addEventListener('change', (e) => { filters.status = e.target.value; renderFeesTable(); });
}

function cancelEditFee() {
  editingId = null;
  el('fee-form').reset();
  el('fee-form-submit').textContent = 'Add record';
  el('fee-form-cancel').classList.add('hidden');
  el('fee-month-to').disabled = false;
  el('fee-month-to').closest('.filter-group').classList.remove('hidden');
}

function startEditFee(record) {
  editingId = record.id;
  el('fee-sport').value = record.sport;
  populateFeeStudentSelect();
  el('fee-student').value = record.studentId;
  el('fee-amount').value = record.amount;
  el('fee-month').value = record.month;
  el('fee-status').value = record.status;
  el('fee-form-submit').textContent = 'Update record';
  el('fee-form-cancel').classList.remove('hidden');
  // Editing always targets one existing record — the multi-month range only applies when adding new ones.
  el('fee-month-to').value = '';
  el('fee-month-to').disabled = true;
  el('fee-month-to').closest('.filter-group').classList.add('hidden');
  el('fee-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function updateFeesStudentData(students) {
  allStudents = students;
  el('fees-form-panel').classList.toggle('hidden', !canManageFees());
  const sports = [...new Set([...KNOWN_SPORTS, ...students.map((s) => s.sport)])];

  const sportSelect = el('fee-sport');
  const prevSport = sportSelect.value;
  sportSelect.innerHTML = sports.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  if (sports.includes(prevSport)) sportSelect.value = prevSport;
  populateFeeStudentSelect();

  const filterSportSelect = el('fee-filter-sport');
  const prevFilterSport = filterSportSelect.value || 'all';
  filterSportSelect.innerHTML = '<option value="all">All sports</option>' +
    sports.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  filterSportSelect.value = sports.includes(prevFilterSport) ? prevFilterSport : 'all';
  filters.sport = filterSportSelect.value;
  renderFeeFilterStudents();
}

function populateFeeStudentSelect() {
  const sport = el('fee-sport').value;
  const students = allStudents.filter((s) => s.sport === sport).sort((a, b) => a.name.localeCompare(b.name));
  el('fee-student').innerHTML = students.length
    ? students.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)} (Grade ${escapeHtml(String(s.grade || '—'))})</option>`).join('')
    : '<option value="" disabled selected>No students registered for this sport</option>';
}

function renderFeeFilterStudents() {
  const sport = filters.sport;
  const students = (sport === 'all' ? allStudents : allStudents.filter((s) => s.sport === sport))
    .sort((a, b) => a.name.localeCompare(b.name));
  const select = el('fee-filter-student');
  const prev = select.value || 'all';
  select.innerHTML = '<option value="all">All students</option>' +
    students.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  select.value = students.some((s) => s.id === prev) ? prev : 'all';
  filters.student = select.value;
}

export function updateFeesData(fees) {
  allFees = fees;
  renderFeesTable();
}

function renderFeesTable() {
  const body = el('fees-table-body');
  const rows = allFees
    .filter((r) => filters.sport === 'all' || r.sport === filters.sport)
    .filter((r) => filters.student === 'all' || r.studentId === filters.student)
    .filter((r) => filters.status === 'all' || r.status === filters.status)
    .sort((a, b) => (b.month || '').localeCompare(a.month || ''));

  const totalDue = rows.filter((r) => r.status === 'due').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalPaid = rows.filter((r) => r.status === 'paid').reduce((sum, r) => sum + Number(r.amount || 0), 0);
  el('fees-stats').innerHTML = `
    <div class="stat-card"><div class="value" style="color:var(--danger)">Rs. ${totalDue.toLocaleString()}</div><div class="label">Total due</div></div>
    <div class="stat-card"><div class="value" style="color:var(--accent-2)">Rs. ${totalPaid.toLocaleString()}</div><div class="label">Total paid</div></div>
    <div class="stat-card"><div class="value">${rows.length}</div><div class="label">Records shown</div></div>
  `;

  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No fee records match.</td></tr>';
    return;
  }
  const canEdit = canManageFees();
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.studentName)}</td>
      <td>${escapeHtml(r.sport)}</td>
      <td>${escapeHtml(r.month)}</td>
      <td>Rs. ${Number(r.amount).toLocaleString()}</td>
      <td><span class="status-pill ${r.status}">${r.status === 'paid' ? 'Paid' : 'Due'}</span></td>
      <td>${canEdit ? `<button class="edit-btn" data-id="${escapeAttr(r.id)}">Edit</button> <button class="delete-btn" data-id="${escapeAttr(r.id)}">Delete</button>` : ''}</td>
    </tr>
  `).join('');

  body.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const record = rows.find((r) => r.id === btn.dataset.id);
      if (record) startEditFee(record);
    });
  });
  body.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (editingId === btn.dataset.id) cancelEditFee();
      deleteFee(btn.dataset.id);
    });
  });
}
