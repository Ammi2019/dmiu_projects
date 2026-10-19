// Lecturer dashboard: identity banner, overview + classes, editable profile and photo.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };
  const ROLE_LABELS = { lecturer: 'Lecturer', class_teacher: 'Class Teacher' };
  let photoUrl = null;

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
      window.location.href = '/login.html?portal=lecturer';
      throw new Error('Your session has expired. Please log in again.');
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : 'Request failed.');
    return body;
  }

  // ---------- photo ----------
  async function loadPhoto() {
    try {
      const res = await fetch('/api/lecturers/me/photo', { headers: authHeaders });
      if (!res.ok) return; // no photo yet — keep the default avatar
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(await res.blob());
      document.getElementById('banner-photo').src = photoUrl;
      document.getElementById('profile-photo-preview').src = photoUrl;
    } catch (err) {
      // keep the default avatar
    }
  }

  const photoInput = document.getElementById('photo-input');
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
      const text = await api('/api/lecturers/me/photo', { method: 'POST', body: formData });
      showMessage('photo-message', text, 'success');
      await loadPhoto();
    } catch (err) {
      showMessage('photo-message', err.message, 'error');
    } finally {
      photoInput.value = '';
    }
  });

  // ---------- profile ----------
  function fillProfile(me) {
    const setText = (id, value) => { document.getElementById(id).textContent = value || '–'; };
    const setValue = (id, value) => { document.getElementById(id).value = value || ''; };

    // Banner (visible on every tab)
    setText('banner-name', me.name);
    setText('banner-id', me.lecturer_id);
    document.getElementById('banner-dept').textContent =
      [ROLE_LABELS[me.role] || 'Lecturer', me.school || me.department_name].filter(Boolean).join(' · ');

    // Overview details
    setText('me-name', me.name);
    setText('me-email', me.email);
    setText('me-id', me.lecturer_id);
    setText('me-role', ROLE_LABELS[me.role] || me.role);
    setText('me-department', me.department_name || 'Not assigned');
    setText('me-hired', formatDate(me.hire_date));
    setText('me-qualification', me.qualification);
    setText('me-specialization', me.specialization);
    setText('me-office', me.office);
    setText('me-office-hours', me.office_hours);
    setText('me-phone', me.phone);

    // Profile form
    setValue('pf-name', me.name);
    setValue('pf-id', me.lecturer_id);
    setValue('pf-email', me.email);
    setValue('pf-department', me.department_name || 'Not assigned');
    setValue('pf-school', me.school || 'Not set');
    // No school yet: let the lecturer pick one (once). After that only the admin can change it.
    document.getElementById('school-picker').hidden = Boolean(me.school);
    document.getElementById('pf-school').hidden = !me.school;
    setValue('pf-qualification', me.qualification);
    setValue('pf-specialization', me.specialization);
    setValue('pf-office', me.office);
    setValue('pf-office-hours', me.office_hours);
    setValue('pf-phone', me.phone);
    setValue('pf-bio', me.bio);
    updateBioCount();
  }

  async function loadMe() {
    try {
      const me = await api('/api/lecturers/me');
      fillProfile(me);
      // Let the assignments tab know which school this lecturer belongs to
      document.dispatchEvent(new CustomEvent('lecturer:loaded', { detail: me }));
      if (Number(me.has_photo)) loadPhoto();
    } catch (err) {
      showMessage('overview-message', err.message, 'error');
    }
  }

  const bioEl = document.getElementById('pf-bio');
  function updateBioCount() {
    document.getElementById('bio-count').textContent = bioEl.value.length;
  }
  bioEl.addEventListener('input', updateBioCount);

  const profileForm = document.getElementById('profile-form');
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('profile-message');
    const btn = profileForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const body = {
      qualification: document.getElementById('pf-qualification').value,
      specialization: document.getElementById('pf-specialization').value,
      office: document.getElementById('pf-office').value,
      office_hours: document.getElementById('pf-office-hours').value,
      phone: document.getElementById('pf-phone').value,
      bio: bioEl.value
    };

    try {
      const text = await api('/api/lecturers/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      showMessage('profile-message', text, 'success');
      fillProfile(await api('/api/lecturers/me'));
    } catch (err) {
      showMessage('profile-message', err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- school (one-time choice) ----------
  (async function loadSchoolOptions() {
    try {
      const res = await fetch('/api/programmes');
      const data = await res.json();
      document.getElementById('pf-school-select').innerHTML =
        '<option value="">Select the school you teach in</option>' +
        data.schools.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    } catch (err) {
      // leave the select empty; saving will show an error
    }
  })();

  document.getElementById('pf-school-save').addEventListener('click', async () => {
    const school = document.getElementById('pf-school-select').value;
    clearMessage('profile-message');
    if (!school) {
      showMessage('profile-message', 'Please choose a school.', 'error');
      return;
    }
    if (!confirm(`Set your school to the ${school}? Only the administrator can change it afterwards.`)) return;
    try {
      const text = await api('/api/lecturers/me/school', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school })
      });
      showMessage('profile-message', text, 'success');
      loadMe();
    } catch (err) {
      showMessage('profile-message', err.message, 'error');
    }
  });

  // Links like <a data-goto="tab-profile"> switch tabs
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-goto]');
    if (!link) return;
    e.preventDefault();
    const tab = document.querySelector(`.tab[data-tab="${link.dataset.goto}"]`);
    if (tab) tab.click();
  });

  // ---------- classes ----------
  async function loadClasses() {
    const tbody = document.querySelector('#classes-table tbody');
    try {
      const rows = await api('/api/lecturers/me/classes');

      document.getElementById('stat-classes').textContent = rows.length;
      document.getElementById('stat-students').textContent =
        rows.reduce((sum, r) => sum + (Number(r.enrolled_count) || 0), 0);
      document.getElementById('stat-pending').textContent =
        rows.reduce((sum, r) => sum + (Number(r.ungraded_count) || 0), 0);

      document.getElementById('classes-empty').hidden = rows.length > 0;
      document.getElementById('classes-table').hidden = rows.length === 0;

      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escapeHtml(r.course_code)}</td>
          <td>${escapeHtml(r.course_title)}</td>
          <td>${escapeHtml(r.credits)}</td>
          <td>${escapeHtml(r.semester)} ${escapeHtml(r.year)}</td>
          <td>${escapeHtml(r.room || '–')}</td>
          <td>${escapeHtml(r.enrolled_count)}${r.capacity ? ' / ' + escapeHtml(r.capacity) : ''}</td>
          <td>${Number(r.ungraded_count) ? `<span class="badge badge-full">${escapeHtml(r.ungraded_count)}</span>` : '<span class="badge badge-ok">All graded</span>'}</td>
        </tr>`).join('');
    } catch (err) {
      showMessage('overview-message', err.message, 'error');
    }
  }

  // ---------- start ----------
  loadMe();
  loadClasses();
});
