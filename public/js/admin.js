const token = localStorage.getItem('token');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// What the person said they were registering as (students also chose a school and programme)
function registeredAs(u) {
  if (u.account_type === 'student') {
    return `<strong>Student</strong>${u.programme ? `<br>${escapeHtml(u.programme)}` : ''}` +
      (u.school ? `<br><small>${escapeHtml(u.school)}</small>` : '');
  }
  if (u.account_type === 'lecturer') {
    return `<strong>Lecturer</strong>${u.school ? `<br><small>${escapeHtml(u.school)}</small>` : ''}`;
  }
  if (u.account_type === 'staff') return '<strong>Other staff</strong>';
  return '<small>Not stated</small>';
}

async function loadPending() {
  const res = await fetch('/api/admin/pending', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const users = await res.json();

  const tbody = document.querySelector('#pending-table tbody');
  tbody.innerHTML = '';

  users.forEach(u => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${registeredAs(u)}</td>
      <td>
        <select data-id="${u.user_id}" class="role-select">
          <option value="student" ${u.account_type === 'student' || !u.account_type ? 'selected' : ''}>Student</option>
          <option value="lecturer" ${u.account_type === 'lecturer' || u.account_type === 'staff' ? 'selected' : ''}>Lecturer</option>
          <option value="administrator">Administrator</option>
          <option value="principal">Principal</option>
          <option value="dean_of_students">Dean of Students</option>
          <option value="dean_academic">Dean (Academic)</option>
          <option value="head_of_department">Head of Department</option>
          <option value="accountant">Accountant</option>
          <option value="registrar">Registrar</option>
          <option value="registry_clerk">Registry Clerk</option>
        </select>
      </td>
      <td>
        <button class="approve-btn" data-id="${u.user_id}">Approve</button>
        <button class="reject-btn" data-id="${u.user_id}">Reject</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  document.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', () => approveUser(btn.dataset.id));
  });
  document.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', () => rejectUser(btn.dataset.id));
  });
}

async function approveUser(userId) {
  const select = document.querySelector(`.role-select[data-id="${userId}"]`);
  const role = select.value;
  const messageEl = document.getElementById('pending-message');

  try {
    const res = await fetch(`/api/admin/users/${userId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ role })
    });

    const text = await res.text();
    if (res.ok) {
      messageEl.textContent = text;
      messageEl.className = 'message show success';
      loadPending();
      loadUsers();
    } else {
      messageEl.textContent = text;
      messageEl.className = 'message show error';
    }
  } catch (err) {
    messageEl.textContent = 'Could not reach the server.';
    messageEl.className = 'message show error';
  }
}

async function rejectUser(userId) {
  const messageEl = document.getElementById('pending-message');

  try {
    const res = await fetch(`/api/admin/users/${userId}/reject`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const text = await res.text();
    if (res.ok) {
      messageEl.textContent = text;
      messageEl.className = 'message show success';
      loadPending();
    } else {
      messageEl.textContent = text;
      messageEl.className = 'message show error';
    }
  } catch (err) {
    messageEl.textContent = 'Could not reach the server.';
    messageEl.className = 'message show error';
  }
}

async function loadUsers() {
  const res = await fetch('/api/admin/users', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const users = await res.json();

  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';

  users.forEach(u => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role)}</td>`;
    tbody.appendChild(row);
  });
}

loadPending();
loadUsers();
