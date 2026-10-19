// Staff dashboard → Account approvals + Users (administrator only).
document.addEventListener('staff:loaded', async () => {
  if (!document.getElementById('tab-approvals')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;

  const ROLE_OPTIONS = [
    ['student', 'Student'], ['lecturer', 'Lecturer'], ['class_teacher', 'Class Teacher'],
    ['head_of_department', 'Head of Department'], ['registrar', 'Registrar'], ['registry_clerk', 'Registry Clerk'],
    ['dean_of_students', 'Dean of Students'], ['dean_academic', 'Dean (Academic)'], ['accountant', 'Accountant'], ['principal', 'Principal'],
    ['administrator', 'Administrator']
  ];
  const label = Object.fromEntries(ROLE_OPTIONS);
  const SCHOOL_ROLES = ['lecturer', 'class_teacher', 'head_of_department'];

  let schools = [];
  try { schools = (await S.programmes()).schools.map(s => s.name); } catch (e) { /* ignore */ }

  // ---------- pending approvals ----------
  function registeredAs(u) {
    const app = u.accepted_application_id
      ? `<br><span class="badge badge-ok">✓ Accepted applicant APP-${String(u.accepted_application_id).padStart(5, '0')}</span>` : '';
    if (u.account_type === 'student') {
      return `<strong>Student</strong>${u.programme ? `<br>${esc(u.programme)}` : ''}${u.school ? `<br><small>${esc(u.school)}</small>` : ''}${app}`;
    }
    if (u.account_type === 'lecturer') return `<strong>Lecturer</strong>${u.school ? `<br><small>${esc(u.school)}</small>` : ''}${app}`;
    if (u.account_type === 'staff') return `<strong>Other staff</strong>${app}`;
    return `<small class="muted">Not stated</small>${app}`;
  }

  function defaultRole(u) {
    if (u.account_type === 'lecturer') return 'lecturer';
    if (u.account_type === 'staff') return 'registry_clerk';
    return 'student';
  }

  async function loadPending() {
    try {
      const users = await S.api('/api/admin/pending');
      document.getElementById('pa-empty').hidden = users.length > 0;
      document.querySelector('#pa-table tbody').innerHTML = users.map(u => `
        <tr data-id="${u.user_id}">
          <td><strong>${esc(u.name)}</strong><br><small>${esc(u.email)}</small></td>
          <td>${registeredAs(u)}</td>
          <td>${new Date(u.created_at).toLocaleDateString()}</td>
          <td>
            <div class="select-wrap table-select"><select class="role-select" aria-label="Role for ${esc(u.name)}">
              ${ROLE_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === defaultRole(u) ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          </td>
          <td class="actions-cell">
            <button type="button" class="btn-accept btn-small" data-approve>Approve</button>
            <button type="button" class="btn-reject btn-small" data-reject>Reject</button>
          </td>
        </tr>`).join('');
    } catch (err) {
      S.say('pa-message', err.message, 'error');
    }
  }

  document.getElementById('pa-table').addEventListener('click', async e => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const name = row.querySelector('strong').textContent;
    try {
      if (e.target.closest('[data-approve]')) {
        const role = row.querySelector('.role-select').value;
        if (role === 'administrator' && !confirm(`Give ${name} full administrator access?`)) return;
        const text = await S.api(`/api/admin/users/${id}/approve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role })
        });
        S.say('pa-message', `${name}: ${text} (${label[role]})`, 'success');
      } else if (e.target.closest('[data-reject]')) {
        if (!confirm(`Reject and remove the registration from ${name}?`)) return;
        S.say('pa-message', await S.api(`/api/admin/users/${id}/reject`, { method: 'DELETE' }), 'success');
      } else {
        return;
      }
      loadPending();
      loadUsers();
    } catch (err) {
      S.say('pa-message', err.message, 'error');
    }
  });

  // ---------- users ----------
  let allUsers = [];

  function renderUsers() {
    const q = document.getElementById('us-search').value.trim().toLowerCase();
    const rows = allUsers.filter(u => !q || [u.name, u.email, label[u.role] || u.role].some(v => String(v || '').toLowerCase().includes(q)));
    document.querySelector('#us-table tbody').innerHTML = rows.map(u => {
      let schoolCell = '<span class="muted">–</span>';
      if (SCHOOL_ROLES.includes(u.role)) {
        schoolCell = `
          <div class="select-wrap table-select"><select class="school-select" data-id="${u.user_id}" aria-label="School for ${esc(u.name)}">
            <option value="">Not assigned</option>
            ${schools.map(s => `<option value="${esc(s)}" ${s === u.school ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select></div>`;
      } else if (u.school) {
        schoolCell = `<small>${esc(u.school)}</small>`;
      }
      return `
        <tr>
          <td><strong>${esc(u.name)}</strong></td>
          <td>${esc(u.email)}</td>
          <td>${esc(label[u.role] || u.role || '–')}</td>
          <td>${schoolCell}</td>
        </tr>`;
    }).join('');
  }

  async function loadUsers() {
    try {
      allUsers = await S.api('/api/admin/users');
      renderUsers();
    } catch (err) {
      S.say('us-message', err.message, 'error');
    }
  }

  document.getElementById('us-search').addEventListener('input', renderUsers);
  document.getElementById('us-table').addEventListener('change', async e => {
    const sel = e.target.closest('.school-select');
    if (!sel || !sel.value) return;
    try {
      S.say('us-message', await S.api(`/api/admin/users/${sel.dataset.id}/school`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ school: sel.value })
      }), 'success');
      const u = allUsers.find(x => String(x.user_id) === sel.dataset.id);
      if (u) u.school = sel.value;
    } catch (err) {
      S.say('us-message', err.message, 'error');
    }
  });

  loadPending();
  loadUsers();
});
