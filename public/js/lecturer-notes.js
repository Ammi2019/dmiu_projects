// Lecturer dashboard → Notes: Units 1–5 per course (upload, replace, remove).
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const say = (text, type) => { const el = document.getElementById('nt-message'); el.textContent = text; el.className = `message show ${type}`; };
  const hush = () => { document.getElementById('nt-message').className = 'message'; };

  let mySchool = null;
  let notes = [];
  let maxUnits = 5;
  let extraCourses = [];   // courses added in this session that have no notes yet
  let selected = null;     // { course, programme }

  const keyOf = c => `${c.course}|${c.programme || ''}`;
  const progLabel = p => p || 'All programmes';

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...auth, ...(options.headers || {}) } });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : 'Request failed.');
    return body;
  }

  function courses() {
    const map = new Map();
    notes.forEach(n => {
      const c = { course: n.course_name, programme: n.programme };
      if (!map.has(keyOf(c))) map.set(keyOf(c), { ...c, count: 0 });
      map.get(keyOf(c)).count++;
    });
    extraCourses.forEach(c => { if (!map.has(keyOf(c))) map.set(keyOf(c), { ...c, count: 0 }); });
    return [...map.values()].sort((a, b) => a.course.localeCompare(b.course));
  }

  function renderCourses() {
    const list = courses();
    document.getElementById('nt-empty').hidden = list.length > 0;
    if (!selected && list.length) selected = list[0];
    document.getElementById('nt-course-list').innerHTML = list.map(c => `
      <button type="button" class="nt-course ${selected && keyOf(selected) === keyOf(c) ? 'active' : ''}" data-key="${esc(keyOf(c))}" role="tab">
        <strong>${esc(c.course)}</strong>
        <small>${esc(progLabel(c.programme))} · ${c.count}/${maxUnits} units</small>
      </button>`).join('');
    renderUnits();
  }

  function renderUnits() {
    const wrap = document.getElementById('nt-units-wrap');
    if (!selected) { wrap.hidden = true; return; }
    wrap.hidden = false;
    document.getElementById('nt-units-title').textContent = selected.course;
    document.getElementById('nt-units-meta').textContent = `${progLabel(selected.programme)} · ${mySchool}`;

    const forCourse = notes.filter(n => n.course_name === selected.course && (n.programme || '') === (selected.programme || ''));
    document.getElementById('nt-units').innerHTML = Array.from({ length: maxUnits }, (_, i) => i + 1).map(no => {
      const u = forCourse.find(n => Number(n.unit_no) === no);
      return `
        <form class="nt-unit ${u ? 'filled' : ''}" data-unit="${no}" novalidate>
          <div class="nt-unit-head">
            <span class="unit-no">Unit ${no}</span>
            ${u ? `<span class="badge badge-ok">Posted ${esc(u.updated_at)}</span>` : '<span class="badge badge-full">Empty</span>'}
          </div>
          <input type="text" name="title" maxlength="200" placeholder="Unit title, e.g. Introduction to SQL" value="${esc(u ? u.title : '')}" aria-label="Unit ${no} title">
          <textarea name="description" rows="2" maxlength="1000" placeholder="Short description (optional)" aria-label="Unit ${no} description">${esc(u ? u.description || '' : '')}</textarea>
          ${u ? `<p class="nt-file">📄 <button type="button" class="link-btn" data-open="${u.note_id}" data-name="${esc(u.file_name)}">${esc(u.file_name)}</button></p>` : ''}
          <label class="sa-file nt-file-pick">
            <input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,.png,.jpg,.jpeg">
            <span class="sa-file-label">${u ? 'Replace file (optional)' : 'Choose notes file (max 20MB)'}</span>
          </label>
          <div class="nt-unit-actions">
            <button type="submit" class="btn-primary btn-small">${u ? 'Save changes' : 'Post unit'}</button>
            ${u ? `<button type="button" class="btn-danger btn-small" data-remove="${u.note_id}">Remove</button>` : ''}
          </div>
        </form>`;
    }).join('');
  }

  async function load() {
    try {
      const data = await api('/api/notes/teaching');
      notes = data.notes;
      maxUnits = data.max_units;
      renderCourses();
    } catch (err) {
      say(err.message, 'error');
    }
  }

  // Wait for lecturer.js to tell us the school
  document.addEventListener('lecturer:loaded', async e => {
    mySchool = e.detail.school || null;
    document.getElementById('nt-no-school').hidden = Boolean(mySchool);
    document.getElementById('nt-workspace').hidden = !mySchool;
    if (!mySchool) return;
    try {
      const data = await api('/api/programmes');
      const school = data.schools.find(s => s.name === mySchool);
      document.getElementById('nt-programme').innerHTML =
        `<option value="">All programmes in the ${esc(mySchool)}</option>` +
        (school ? school.programmes.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('') : '');
    } catch (err) { /* select stays with the default */ }
    load();
  });

  // ---------- events ----------
  document.getElementById('nt-course-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    hush();
    selected = courses().find(c => keyOf(c) === btn.dataset.key);
    renderCourses();
  });

  document.getElementById('nt-add-form').addEventListener('submit', e => {
    e.preventDefault();
    const course = document.getElementById('nt-course').value.trim();
    const programme = document.getElementById('nt-programme').value || null;
    if (!course) return say('Enter the course or module name.', 'error');
    hush();
    const c = { course, programme };
    if (!courses().some(x => keyOf(x) === keyOf(c))) extraCourses.push(c);
    selected = c;
    document.getElementById('nt-course').value = '';
    document.getElementById('nt-add').open = false;
    renderCourses();
  });

  const units = document.getElementById('nt-units');

  units.addEventListener('change', e => {
    if (!e.target.matches('input[type="file"]')) return;
    const f = e.target.files[0];
    e.target.nextElementSibling.textContent = f ? f.name : 'Choose notes file (max 20MB)';
    e.target.closest('.sa-file').classList.toggle('has-file', Boolean(f));
  });

  units.addEventListener('submit', async e => {
    const form = e.target.closest('.nt-unit');
    if (!form) return;
    e.preventDefault();
    hush();
    const isNew = !form.classList.contains('filled');
    const file = form.file.files[0];
    if (!form.title.value.trim()) return say(`Enter a title for Unit ${form.dataset.unit}.`, 'error');
    if (isNew && !file) return say(`Attach the notes file for Unit ${form.dataset.unit}.`, 'error');
    if (file && file.size > 20 * 1024 * 1024) return say('File is too large. Maximum size is 20MB.', 'error');

    const fd = new FormData();
    fd.append('course_name', selected.course);
    fd.append('programme', selected.programme || '');
    fd.append('unit_no', form.dataset.unit);
    fd.append('title', form.title.value.trim());
    fd.append('description', form.description.value.trim());
    if (file) fd.append('file', file);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      say(await api('/api/notes', { method: 'POST', body: fd }), 'success');
      await load();
    } catch (err) {
      say(err.message, 'error');
      btn.disabled = false;
    }
  });

  units.addEventListener('click', async e => {
    const open = e.target.closest('[data-open]');
    const remove = e.target.closest('[data-remove]');
    try {
      if (open) {
        const res = await fetch(`/api/notes/${open.dataset.open}/file`, { headers: auth });
        if (!res.ok) throw new Error(await res.text());
        window.open(URL.createObjectURL(await res.blob()), '_blank');
      }
      if (remove) {
        if (!confirm('Remove this unit? Students will no longer see it.')) return;
        say(await api(`/api/notes/${remove.dataset.remove}`, { method: 'DELETE' }), 'success');
        // keep the course selected even if it now has no units
        if (selected && !extraCourses.some(c => keyOf(c) === keyOf(selected))) extraCourses.push(selected);
        await load();
      }
    } catch (err) {
      say(err.message, 'error');
    }
  });
});
