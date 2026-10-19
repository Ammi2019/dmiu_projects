// Student dashboard: overview, my courses (with drop), and enrollment.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  let allSections = [];

  // ---------- helpers ----------
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function formatDate(value) {
    if (!value) return '–';
    // Treat plain 'YYYY-MM-DD' as a local date so it never shifts by a day
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value);
    return isNaN(d) ? '–' : d.toLocaleDateString();
  }

  function showMessage(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `message show ${type}`;
  }

  function clearMessage(id) {
    document.getElementById(id).className = 'message';
  }

  // Wraps fetch: sends the token, logs out on expired session, throws server text on error
  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...authHeaders, ...(options.headers || {}) }
    });
    const expired = res.status === 401 ||
      (res.status === 403 && (await res.clone().text()).includes('token'));
    if (expired) {
      localStorage.clear();
      window.location.href = '/login.html';
      throw new Error('Your session has expired. Please log in again.');
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : 'Request failed.');
    return body;
  }

  // ---------- overview + identity banner ----------
  const DEFAULT_PHOTO = '/images/default-avatar.svg';
  let photoUrl = null;

  async function loadPhoto() {
    try {
      const res = await fetch('/api/students/me/photo', { headers: authHeaders });
      if (!res.ok) return; // no photo yet — keep the default avatar
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(await res.blob());
      document.getElementById('banner-photo').src = photoUrl;
      document.getElementById('profile-photo-preview').src = photoUrl;
    } catch (err) {
      // keep the default avatar
    }
  }

  function fillProfile(me) {
    const setText = (id, value) => { document.getElementById(id).textContent = value || '–'; };

    // Banner (visible on every tab)
    setText('banner-name', me.name);
    setText('banner-id', me.student_id);
    // Programme under the name; fall back to the department if no programme is recorded
    document.getElementById('banner-dept').textContent = me.programme
      ? [me.programme, me.school].filter(Boolean).join(' · ')
      : (me.department_name || '');

    // Overview details
    setText('me-name', me.name);
    setText('me-email', me.email);
    setText('me-id', me.student_id);
    setText('me-programme', me.programme || 'Not recorded');
    setText('me-school', me.school);
    setText('me-department', me.department_name || 'Not assigned');
    setText('me-dob', formatDate(me.date_of_birth));
    setText('me-joined', formatDate(me.enrollment_date));
    setText('me-phone', me.phone);
    setText('me-address', me.address);
    setText('me-kin', me.next_of_kin_name
      ? `${me.next_of_kin_name}${me.next_of_kin_phone ? ' (' + me.next_of_kin_phone + ')' : ''}`
      : '');

    // Profile form
    document.getElementById('pf-name').value = me.name || '';
    document.getElementById('pf-id').value = me.student_id || '';
    document.getElementById('pf-email').value = me.email || '';
    document.getElementById('pf-dob').value = me.date_of_birth || '';
    document.getElementById('pf-phone').value = me.phone || '';
    document.getElementById('pf-address').value = me.address || '';
    document.getElementById('pf-kin-name').value = me.next_of_kin_name || '';
    document.getElementById('pf-kin-phone').value = me.next_of_kin_phone || '';
  }

  async function loadMe() {
    try {
      const me = await api('/api/students/me');
      fillProfile(me);
      if (Number(me.has_photo)) loadPhoto();
    } catch (err) {
      showMessage('overview-message', err.message, 'error');
    }
  }

  // ---------- my profile: details ----------
  const profileForm = document.getElementById('student-profile-form');
  document.getElementById('pf-dob').max = new Date().toISOString().slice(0, 10);

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('profile-message');
    const btn = profileForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const body = {
      date_of_birth: document.getElementById('pf-dob').value,
      phone: document.getElementById('pf-phone').value,
      address: document.getElementById('pf-address').value,
      next_of_kin_name: document.getElementById('pf-kin-name').value,
      next_of_kin_phone: document.getElementById('pf-kin-phone').value
    };

    try {
      const text = await api('/api/students/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      showMessage('profile-message', text, 'success');
      fillProfile(await api('/api/students/me'));
    } catch (err) {
      showMessage('profile-message', err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- my profile: photo ----------
  const photoInput = document.getElementById('student-photo-input');

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    clearMessage('photo-message');

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      showMessage('photo-message', 'Only PNG and JPEG photos are allowed.', 'error');
      photoInput.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showMessage('photo-message', 'Photo is too large. Maximum size is 5MB.', 'error');
      photoInput.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const text = await api('/api/students/me/photo', { method: 'POST', body: formData });
      showMessage('photo-message', text, 'success');
      await loadPhoto();
    } catch (err) {
      showMessage('photo-message', err.message, 'error');
    } finally {
      photoInput.value = '';
    }
  });

  // ---------- my courses ----------
  async function loadMyCourses() {
    const tbody = document.querySelector('#my-courses-table tbody');
    const empty = document.getElementById('my-courses-empty');

    try {
      const rows = await api('/api/enrollments/mine');

      document.getElementById('stat-courses').textContent = rows.length;
      document.getElementById('stat-credits').textContent =
        rows.reduce((sum, r) => sum + (Number(r.credits) || 0), 0);
      document.getElementById('stat-graded').textContent = rows.filter(r => r.grade).length;

      empty.hidden = rows.length > 0;
      document.getElementById('my-courses-table').hidden = rows.length === 0;

      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escapeHtml(r.course_code)}</td>
          <td>${escapeHtml(r.course_title)}</td>
          <td>${escapeHtml(r.credits)}</td>
          <td>${escapeHtml(r.semester)} ${escapeHtml(r.year)}</td>
          <td>${escapeHtml(r.lecturer_name || '–')}</td>
          <td>${escapeHtml(r.room || '–')}</td>
          <td>${r.grade ? `<span class="badge badge-grade">${escapeHtml(r.grade)}</span>` : '<span class="muted">Pending</span>'}</td>
          <td>${r.grade ? '' : `<button class="btn-danger btn-small drop-btn" data-id="${r.enrollment_id}" data-title="${escapeHtml(r.course_title)}">Drop</button>`}</td>
        </tr>`).join('');
    } catch (err) {
      showMessage('courses-message', err.message, 'error');
    }
  }

  document.querySelector('#my-courses-table tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('.drop-btn');
    if (!btn) return;
    if (!confirm(`Drop "${btn.dataset.title}"?`)) return;

    btn.disabled = true;
    clearMessage('courses-message');
    try {
      const text = await api(`/api/enrollments/${btn.dataset.id}`, { method: 'DELETE' });
      showMessage('courses-message', text, 'success');
      await Promise.all([loadMyCourses(), loadSections()]);
    } catch (err) {
      showMessage('courses-message', err.message, 'error');
      btn.disabled = false;
    }
  });

  // ---------- enroll ----------
  function renderSections() {
    const tbody = document.querySelector('#sections-table tbody');
    const empty = document.getElementById('sections-empty');
    const q = document.getElementById('section-search').value.trim().toLowerCase();

    const filtered = allSections.filter(s =>
      [s.course_code, s.course_title, s.lecturer_name, s.department_name]
        .some(v => String(v || '').toLowerCase().includes(q))
    );

    empty.hidden = filtered.length > 0;

    tbody.innerHTML = filtered.map(s => {
      const taken = Number(s.enrolled_count) || 0;
      const full = s.capacity && taken >= s.capacity;
      const seats = s.capacity ? `${Math.max(s.capacity - taken, 0)} of ${s.capacity} left` : 'Open';

      let action;
      if (Number(s.is_enrolled)) action = '<span class="badge badge-ok">Enrolled</span>';
      else if (full) action = '<span class="badge badge-full">Full</span>';
      else action = `<button class="btn-primary btn-small enroll-btn" data-id="${s.section_id}">Enroll</button>`;

      return `
        <tr>
          <td>${escapeHtml(s.course_code)}</td>
          <td>${escapeHtml(s.course_title)}</td>
          <td>${escapeHtml(s.department_name || '–')}</td>
          <td>${escapeHtml(s.credits)}</td>
          <td>${escapeHtml(s.semester)} ${escapeHtml(s.year)}</td>
          <td>${escapeHtml(s.lecturer_name || '–')}</td>
          <td>${seats}</td>
          <td>${action}</td>
        </tr>`;
    }).join('');
  }

  async function loadSections() {
    try {
      allSections = await api('/api/enrollments/available');
      renderSections();
    } catch (err) {
      showMessage('enroll-message', err.message, 'error');
    }
  }

  document.getElementById('section-search').addEventListener('input', renderSections);

  document.querySelector('#sections-table tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('.enroll-btn');
    if (!btn) return;

    btn.disabled = true;
    clearMessage('enroll-message');
    try {
      await api('/api/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_id: Number(btn.dataset.id) })
      });
      showMessage('enroll-message', 'Enrolled successfully.', 'success');
      await Promise.all([loadMyCourses(), loadSections()]);
    } catch (err) {
      showMessage('enroll-message', err.message, 'error');
      btn.disabled = false;
    }
  });

  // ---------- start ----------
  loadMe();
  loadMyCourses();
  loadSections();
});
