// Student dashboard → Assignments tab: see Assignment 1 & 2 for my programme and submit work.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const authHeaders = { 'Authorization': `Bearer ${token}` };
  const MAX_SIZE = 10 * 1024 * 1024;
  const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,.png,.jpg,.jpeg';

  // ---------- helpers ----------
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function formatDue(value) {
    const d = new Date(value);
    return isNaN(d) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // "in 3 days", "in 5 hours", "2 days ago"
  function relative(value) {
    const diff = new Date(value) - new Date();
    const abs = Math.abs(diff);
    const units = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];
    for (const [name, ms] of units) {
      if (abs >= ms || name === 'minute') {
        const n = Math.max(1, Math.round(abs / ms));
        const label = `${n} ${name}${n === 1 ? '' : 's'}`;
        return diff >= 0 ? `in ${label}` : `${label} ago`;
      }
    }
  }

  function showMessage(text, type) {
    const el = document.getElementById('sa-message');
    el.textContent = text;
    el.className = `message show ${type}`;
  }

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof body === 'string' ? body : (body.message || 'Request failed.'));
    return body;
  }

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

  // ---------- render ----------
  function statusBadge(a) {
    if (a.my_submitted_at) {
      return Number(a.my_is_late)
        ? '<span class="badge badge-late">Submitted late</span>'
        : '<span class="badge badge-ok">Submitted</span>';
    }
    return Number(a.is_past_due)
      ? '<span class="badge badge-danger">Overdue</span>'
      : '<span class="badge badge-full">Not submitted</span>';
  }

  function card(a) {
    const pastDue = Number(a.is_past_due);
    const submitted = Boolean(a.my_submitted_at);
    // Can submit if: not past due, or past due but nothing submitted yet (accepted as late)
    const canSubmit = !pastDue || !submitted;

    let submitArea = '';
    if (canSubmit) {
      submitArea = `
        <form class="sa-submit" data-id="${a.assignment_id}" novalidate>
          <label class="sa-file">
            <input type="file" name="file" accept="${ACCEPT}" required>
            <span class="sa-file-label">${submitted ? 'Choose a new file to replace your submission' : 'Choose your file'}</span>
          </label>
          <textarea name="comment" rows="2" maxlength="1000" placeholder="Comment for your lecturer (optional)"></textarea>
          <button type="submit" class="btn-cta btn-cta-sm">
            <span class="btn-cta-label">${submitted ? 'Replace submission' : (pastDue ? 'Submit late' : 'Submit assignment')}</span>
            <span class="spinner" aria-hidden="true"></span>
          </button>
          ${pastDue ? '<p class="field-hint">The deadline has passed. A submission now will be marked late and cannot be changed.</p>' : ''}
        </form>`;
    } else {
      submitArea = '<p class="field-hint">The deadline has passed, so your submission can no longer be changed.</p>';
    }

    return `
      <article class="sa-card ${pastDue && !submitted ? 'is-overdue' : ''}">
        <div class="sa-card-head">
          <div>
            <p class="sa-course">${escapeHtml(a.course_name)}</p>
            <h4>${escapeHtml(a.title)}</h4>
            <p class="sa-meta">Posted by ${escapeHtml(a.lecturer_name)}</p>
          </div>
          ${statusBadge(a)}
        </div>

        <p class="sa-due ${pastDue ? 'past' : ''}">
          Due <strong>${escapeHtml(formatDue(a.due_at))}</strong> · ${escapeHtml(relative(a.due_at))}
        </p>

        ${a.instructions ? `<div class="sa-instructions">${escapeHtml(a.instructions)}</div>` : ''}
        ${a.file_name ? `<button type="button" class="btn-ghost btn-small" data-attachment="${a.assignment_id}" data-name="${escapeHtml(a.file_name)}">⬇ ${escapeHtml(a.file_name)}</button>` : ''}

        ${submitted ? `
          <div class="sa-mine">
            <span>Your submission: <strong>${escapeHtml(a.my_file_name)}</strong> · ${escapeHtml(a.my_submitted_at)}</span>
            <button type="button" class="btn-ghost btn-small" data-mine="${a.assignment_id}" data-name="${escapeHtml(a.my_file_name)}">Download</button>
          </div>
          ${a.my_comment ? `<p class="sa-meta">Your comment: ${escapeHtml(a.my_comment)}</p>` : ''}` : ''}

        ${submitArea}
        <p class="message sa-card-message" role="status" aria-live="polite"></p>
      </article>`;
  }

  async function load() {
    try {
      const data = await api('/api/assignments/mine');
      const noProgramme = !data.school;
      document.getElementById('sa-no-programme').hidden = !noProgramme;
      document.getElementById('sa-groups').hidden = noProgramme;
      if (noProgramme) return;

      document.getElementById('sa-intro').textContent =
        `Assignments for ${data.programme || 'your programme'} · ${data.school}`;

      [1, 2].forEach(n => {
        const items = data.assignments.filter(a => Number(a.assignment_no) === n);
        document.getElementById(`sa-list-${n}`).innerHTML = items.map(card).join('');
        document.getElementById(`sa-empty-${n}`).hidden = items.length > 0;
      });
    } catch (err) {
      showMessage(err.message, 'error');
    }
  }

  // ---------- events ----------
  const groups = document.getElementById('sa-groups');

  // Show the chosen file name on the file button
  groups.addEventListener('change', e => {
    if (!e.target.matches('.sa-file input')) return;
    const file = e.target.files[0];
    e.target.nextElementSibling.textContent = file ? file.name : 'Choose your file';
    e.target.closest('.sa-file').classList.toggle('has-file', Boolean(file));
  });

  groups.addEventListener('click', async e => {
    const att = e.target.closest('[data-attachment]');
    const mine = e.target.closest('[data-mine]');
    try {
      if (att) await download(`/api/assignments/${att.dataset.attachment}/attachment`, att.dataset.name);
      if (mine) await download(`/api/assignments/${mine.dataset.mine}/my-submission/file`, mine.dataset.name);
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  groups.addEventListener('submit', async e => {
    const form = e.target.closest('.sa-submit');
    if (!form) return;
    e.preventDefault();

    const msg = form.parentElement.querySelector('.sa-card-message');
    const say = (text, type) => { msg.textContent = text; msg.className = `message sa-card-message show ${type}`; };
    const file = form.querySelector('input[type="file"]').files[0];

    if (!file) return say('Choose a file to submit.', 'error');
    if (file.size > MAX_SIZE) return say('File is too large. Maximum size is 10MB.', 'error');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const text = await api(`/api/assignments/${form.dataset.id}/submit`, { method: 'POST', body: new FormData(form) });
      showMessage(text, 'success');
      await load();
    } catch (err) {
      say(err.message, 'error');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  load();
});
