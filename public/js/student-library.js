// Student dashboard → Library: course notes (Units 1–5) grouped by course.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const say = (text, type) => { const el = document.getElementById('lib-message'); el.textContent = text; el.className = `message show ${type}`; };
  const KIND = name => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return { pdf: 'PDF', doc: 'Word', docx: 'Word', ppt: 'Slides', pptx: 'Slides', xls: 'Excel', xlsx: 'Excel', zip: 'ZIP', txt: 'Text', png: 'Image', jpg: 'Image', jpeg: 'Image' }[ext] || 'File';
  };

  let notes = [];
  let maxUnits = 5;

  function render() {
    const q = document.getElementById('lib-search').value.trim().toLowerCase();
    // Group by course (and lecturer, in case two lecturers teach a course with the same name)
    const courses = new Map();
    notes.forEach(n => {
      const key = `${n.course_name}|${n.lecturer_name}`;
      if (!courses.has(key)) courses.set(key, { course: n.course_name, lecturer: n.lecturer_name, units: {} });
      courses.get(key).units[n.unit_no] = n;
    });
    const groups = [...courses.values()].filter(c =>
      !q || c.course.toLowerCase().includes(q) || Object.values(c.units).some(u => u.title.toLowerCase().includes(q)));

    document.getElementById('lib-empty').hidden = groups.length > 0;
    document.getElementById('lib-list').innerHTML = groups.map(c => {
      const posted = Object.keys(c.units).length;
      const units = Array.from({ length: maxUnits }, (_, i) => i + 1).map(no => {
        const u = c.units[no];
        if (!u) return `<li class="unit-slot empty"><span class="unit-no">Unit ${no}</span><span class="muted">Not posted yet</span></li>`;
        return `
          <li class="unit-slot">
            <span class="unit-no">Unit ${no}</span>
            <span class="unit-body">
              <strong>${esc(u.title)}</strong>
              ${u.description ? `<small>${esc(u.description)}</small>` : ''}
              <small class="muted">${KIND(u.file_name)} · updated ${esc(u.updated_at)}</small>
            </span>
            <button type="button" class="btn-primary btn-small" data-open="${u.note_id}" data-name="${esc(u.file_name)}">Open</button>
          </li>`;
      }).join('');
      return `
        <article class="lib-course">
          <header>
            <div>
              <h3>${esc(c.course)}</h3>
              <p class="sa-meta">Lecturer: ${esc(c.lecturer)}</p>
            </div>
            <span class="badge ${posted === maxUnits ? 'badge-ok' : 'badge-full'}">${posted} of ${maxUnits} units</span>
          </header>
          <ol class="unit-list">${units}</ol>
        </article>`;
    }).join('');
  }

  async function load() {
    try {
      const res = await fetch('/api/notes/library', { headers: auth });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      notes = data.notes;
      maxUnits = data.max_units;
      if (data.programme) document.getElementById('lib-intro').textContent =
        `Course notes for ${data.programme} · ${data.school}. Each course has up to ${maxUnits} units.`;
      render();
    } catch (err) {
      say(err.message || 'Could not load the library.', 'error');
    }
  }

  document.getElementById('lib-search').addEventListener('input', render);
  document.getElementById('lib-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-open]');
    if (!btn) return;
    try {
      const res = await fetch(`/api/notes/${btn.dataset.open}/file`, { headers: auth });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // PDFs and images open in a new tab; other files download
      if (/pdf|image/.test(blob.type)) { window.open(url, '_blank'); return; }
      const a = document.createElement('a');
      a.href = url; a.download = btn.dataset.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      say(err.message, 'error');
    }
  });

  load();
});
