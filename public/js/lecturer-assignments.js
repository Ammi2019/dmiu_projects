// Lecturer dashboard → Assignments tab: post Assignment 1 / 2, list them, view submissions.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  const form = document.getElementById('asg-form');
  const programmeSelect = document.getElementById('asg-programme');
  const listEl = document.getElementById('asg-list');
  const subsPanel = document.getElementById('asg-subs');
  let mySchool = null;

  // ---------- helpers ----------
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function formatDue(value) {
    if (!value) return '–';
    const d = new Date(value);
    return isNaN(d) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function showMessage(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `message show ${type}`;
  }
  const clearMessage = id => { document.getElementById(id).className = 'message'; };

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : (body.message || 'Request failed.'));
    return body;
  }

  // Downloads need the auth header, so fetch the file and hand it to the browser
  async function download(url, fallbackName) {
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = match ? decodeURIComponent(match[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- setup once we know the lecturer's school ----------
  document.addEventListener('lecturer:loaded', async (e) => {
    mySchool = e.detail.school || null;
    document.getElementById('asg-no-school').hidden = Boolean(mySchool);
    document.getElementById('asg-workspace').hidden = !mySchool;
    if (!mySchool) return;

    document.getElementById('asg-school-name').textContent = mySchool;

    try {
      const data = await api('/api/programmes');
      const school = data.schools.find(s => s.name === mySchool);
      programmeSelect.innerHTML =
        `<option value="">All programmes in the ${escapeHtml(mySchool)}</option>` +
        (school ? school.programmes.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join('') : '');
    } catch (err) {
      programmeSelect.innerHTML = '<option value="">All programmes in my school</option>';
    }

    // Due date can't be in the past
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    document.getElementById('asg-due').min = now.toISOString().slice(0, 16);

    loadAssignments();
  });

  // ---------- post ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage('asg-message');

    const course = document.getElementById('asg-course').value.trim();
    const title = document.getElementById('asg-title').value.trim();
    const due = document.getElementById('asg-due').value;
    const file = document.getElementById('asg-file').files[0];

    if (!course) return showMessage('asg-message', 'Enter the course or module name.', 'error');
    if (!title) return showMessage('asg-message', 'Enter a title for the assignment.', 'error');
    if (!due) return showMessage('asg-message', 'Choose a due date and time.', 'error');
    if (new Date(due) <= new Date()) return showMessage('asg-message', 'The due date must be in the future.', 'error');
    if (file && file.size > 10 * 1024 * 1024) return showMessage('asg-message', 'Attachment is too large. Maximum size is 10MB.', 'error');

    const formData = new FormData(form);
    if (!file) formData.delete('attachment');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const body = await api('/api/assignments', { method: 'POST', body: formData });
      showMessage('asg-message', body.message || 'Assignment posted.', 'success');
      form.reset();
      loadAssignments();
    } catch (err) {
      showMessage('asg-message', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  // ---------- list ----------
  async function loadAssignments() {
    try {
      const { assignments } = await api('/api/assignments/teaching');
      document.getElementById('asg-empty').hidden = assignments.length > 0;

      listEl.innerHTML = assignments.map(a => {
        const submitted = Number(a.submitted_count) || 0;
        const total = Number(a.student_count) || 0;
        const pct = total ? Math.round((submitted / total) * 100) : 0;
        return `
          <article class="asg-card">
            <div class="asg-card-top">
              <span class="asg-no">Assignment ${a.assignment_no}</span>
              <span class="badge ${Number(a.is_past_due) ? 'badge-full' : 'badge-ok'}">${Number(a.is_past_due) ? 'Closed' : 'Open'}</span>
            </div>
            <h4>${escapeHtml(a.title)}</h4>
            <p class="asg-meta">${escapeHtml(a.course_name)} · ${escapeHtml(a.programme || 'All programmes')}</p>
            <p class="asg-meta">Due ${escapeHtml(formatDue(a.due_at))}</p>
            <div class="asg-progress" aria-label="${submitted} of ${total} submitted">
              <div class="asg-progress-bar" style="width:${pct}%"></div>
            </div>
            <p class="asg-meta"><strong>${submitted}</strong> of ${total} student${total === 1 ? '' : 's'} submitted</p>
            <div class="asg-actions">
              <button type="button" class="btn-primary btn-small" data-view="${a.assignment_id}">View submissions</button>
              ${a.file_name ? `<button type="button" class="btn-ghost btn-small" data-attachment="${a.assignment_id}" data-name="${escapeHtml(a.file_name)}">Attachment</button>` : ''}
              <button type="button" class="btn-danger btn-small" data-delete="${a.assignment_id}" data-title="${escapeHtml(a.title)}">Delete</button>
            </div>
          </article>`;
      }).join('');
    } catch (err) {
      showMessage('asg-list-message', err.message, 'error');
    }
  }

  listEl.addEventListener('click', async (e) => {
    const view = e.target.closest('[data-view]');
    const del = e.target.closest('[data-delete]');
    const att = e.target.closest('[data-attachment]');
    clearMessage('asg-list-message');

    if (view) return openSubmissions(view.dataset.view);

    if (att) {
      try { await download(`/api/assignments/${att.dataset.attachment}/attachment`, att.dataset.name); }
      catch (err) { showMessage('asg-list-message', err.message, 'error'); }
      return;
    }

    if (del) {
      if (!confirm(`Delete "${del.dataset.title}"? Students' submissions for it will also be deleted.`)) return;
      try {
        const text = await api(`/api/assignments/${del.dataset.delete}`, { method: 'DELETE' });
        showMessage('asg-list-message', text, 'success');
        subsPanel.hidden = true;
        loadAssignments();
      } catch (err) {
        showMessage('asg-list-message', err.message, 'error');
      }
    }
  });

  // ---------- submissions ----------
  async function openSubmissions(id) {
    try {
      const { assignment: a, students } = await api(`/api/assignments/${id}/submissions`);
      document.getElementById('subs-title').textContent = `Assignment ${a.assignment_no}: ${a.title}`;
      const submitted = students.filter(s => s.submission_id).length;
      document.getElementById('subs-meta').textContent =
        `${a.course_name} · ${a.programme || 'All programmes'} · due ${formatDue(a.due_at)} · ${submitted} of ${students.length} submitted`;

      document.getElementById('subs-empty').hidden = students.length > 0;
      document.querySelector('#subs-table tbody').innerHTML = students.map(s => {
        let status = '<span class="badge badge-full">Not submitted</span>';
        if (s.submission_id) {
          status = Number(s.is_late)
            ? '<span class="badge badge-late">Late</span>'
            : '<span class="badge badge-ok">Submitted</span>';
        }
        return `
          <tr>
            <td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.email)}</small></td>
            <td>${escapeHtml(s.programme || '–')}</td>
            <td>${status}</td>
            <td>${escapeHtml(s.submitted_at || '–')}</td>
            <td>${s.submission_id ? `<button type="button" class="btn-ghost btn-small" data-sub="${s.submission_id}" data-name="${escapeHtml(s.file_name)}">Download</button>` : '–'}</td>
            <td class="wrap">${escapeHtml(s.comment || '')}</td>
          </tr>`;
      }).join('');

      subsPanel.hidden = false;
      subsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showMessage('asg-list-message', err.message, 'error');
    }
  }

  document.getElementById('subs-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-sub]');
    if (!btn) return;
    try { await download(`/api/assignments/submissions/${btn.dataset.sub}/file`, btn.dataset.name); }
    catch (err) { showMessage('asg-list-message', err.message, 'error'); }
  });

  document.getElementById('subs-close').addEventListener('click', () => { subsPanel.hidden = true; });
});
