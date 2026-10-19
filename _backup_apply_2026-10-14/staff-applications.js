// Staff dashboard → Applications: list, filter, open, notes, accept / reject.
document.addEventListener('staff:loaded', () => {
  if (!document.getElementById('tab-applications')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  let status = 'pending';
  let openId = null;

  const STATUS_BADGE = {
    pending: '<span class="badge badge-late">Pending</span>',
    accepted: '<span class="badge badge-ok">Accepted</span>',
    rejected: '<span class="badge badge-danger">Rejected</span>'
  };
  const ref = id => `APP-${String(id).padStart(5, '0')}`;

  const introBase = S.me.can.decideApplications
    ? 'Review each application, read the documents, then accept or reject. Your decision is recorded with your name.'
    : 'You can review applications and add notes. Decisions are made by the Registrar, Principal or Administrator.';
  document.getElementById('ap-intro').textContent = introBase;

  // ---------- list ----------
  async function load() {
    S.hush('ap-message');
    const q = document.getElementById('ap-search').value.trim();
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const data = await S.api(`/api/applications?${params}`);
      document.getElementById('ap-intro').textContent = introBase + (data.school ? ` Showing applications for the ${data.school}.` : '');
      const list = document.getElementById('ap-list');
      document.getElementById('ap-empty').hidden = data.applications.length > 0;
      list.innerHTML = data.applications.map(a => `
        <button type="button" class="row-item ${String(a.application_id) === String(openId) ? 'active' : ''}" data-id="${a.application_id}">
          <span class="row-main">
            <strong>${esc(a.name)}</strong>
            <small>${esc(a.programme || a.department_name || 'No programme')}</small>
          </span>
          <span class="row-side">
            ${STATUS_BADGE[a.status] || ''}
            <small>${esc(ref(a.application_id))} · ${esc((a.applied_at || '').slice(0, 10))}${Number(a.notes_count) ? ` · ${a.notes_count} note${a.notes_count == 1 ? '' : 's'}` : ''}</small>
          </span>
        </button>`).join('');
    } catch (err) {
      S.say('ap-message', err.message, 'error');
    }
  }

  document.querySelectorAll('#tab-applications .seg-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('#tab-applications .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    status = btn.dataset.status;
    load();
  }));
  document.getElementById('ap-search').addEventListener('input', S.debounce(load));
  document.getElementById('ap-list').addEventListener('click', e => {
    const row = e.target.closest('[data-id]');
    if (row) open(row.dataset.id);
  });

  // ---------- detail ----------
  async function open(id) {
    openId = id;
    document.querySelectorAll('#ap-list .row-item').forEach(r => r.classList.toggle('active', r.dataset.id === String(id)));
    S.hush('apd-message');
    try {
      const a = await S.api(`/api/applications/${id}`);
      document.getElementById('apd-ref').textContent = ref(a.application_id);
      document.getElementById('apd-name').textContent = a.name;
      document.getElementById('apd-contact').textContent = [a.email, a.phone].filter(Boolean).join(' · ');
      document.getElementById('apd-status').innerHTML = STATUS_BADGE[a.status] || '';
      document.getElementById('apd-programme').textContent = a.programme || a.department_name || '–';
      document.getElementById('apd-school').textContent = a.school || '–';
      document.getElementById('apd-applied').textContent = a.applied_at || '–';
      document.getElementById('apd-decision').textContent =
        a.status === 'pending' ? 'Not decided yet' : `${a.status === 'accepted' ? 'Accepted' : 'Rejected'} by ${a.decided_by || 'staff'} on ${a.decided_at || ''}`;
      document.getElementById('apd-account').innerHTML = a.account
        ? `Registered on the portal (${esc(a.account.status)}${a.account.role ? ', ' + esc(a.account.role) : ''})`
        : (a.status === 'accepted' ? '<span class="muted">Not registered yet — ask the applicant to create a student account with this email.</span>' : '<span class="muted">No portal account</span>');

      document.getElementById('apd-quals').innerHTML = a.qualifications.length
        ? a.qualifications.map(q => `<tr><td>${esc(q.subject)}</td><td class="num">${esc(q.result)}</td></tr>`).join('')
        : '<tr><td colspan="2" class="muted">None given</td></tr>';

      document.getElementById('apd-docs').innerHTML = a.documents.length
        ? a.documents.map(d => `<button type="button" class="btn-ghost btn-small" data-doc="${d.document_id}" data-name="${esc(d.file_name)}" data-type="${esc(d.file_type)}">📄 ${esc(d.file_name)}</button>`).join('')
        : '<span class="muted">No documents uploaded</span>';

      const decide = document.getElementById('apd-decide');
      decide.hidden = !a.can_decide;
      decide.querySelector('[data-decide="accepted"]').hidden = a.status === 'accepted';
      decide.querySelector('[data-decide="rejected"]').hidden = a.status === 'rejected';
      document.getElementById('apd-reopen').hidden = a.status === 'pending';

      document.getElementById('apd-notes').innerHTML = a.notes.length
        ? a.notes.map(n => `<li><p>${esc(n.note)}</p><small>${esc(n.author)} · ${esc(n.created_at)}</small></li>`).join('')
        : '<li class="muted">No notes yet.</li>';

      const panel = document.getElementById('ap-detail');
      panel.hidden = false;
      if (window.innerWidth < 900) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      S.say('ap-message', err.message, 'error');
    }
  }

  // Documents: PDFs and images open in a new tab; others download
  document.getElementById('apd-docs').addEventListener('click', async e => {
    const btn = e.target.closest('[data-doc]');
    if (!btn) return;
    const inline = /pdf|image/.test(btn.dataset.type);
    try { await S.download(`/api/applications/documents/${btn.dataset.doc}`, btn.dataset.name, inline); }
    catch (err) { S.say('apd-message', err.message, 'error'); }
  });

  // Decision
  document.getElementById('apd-decide').addEventListener('click', async e => {
    const btn = e.target.closest('[data-decide]');
    if (!btn) return;
    const newStatus = btn.dataset.decide;
    const name = document.getElementById('apd-name').textContent;
    const verb = { accepted: 'Accept', rejected: 'Reject', pending: 'Reopen' }[newStatus];
    if (!confirm(`${verb} the application from ${name}?`)) return;
    const note = document.getElementById('apd-decision-note');
    try {
      const text = await S.api(`/api/applications/${openId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, note: note.value })
      });
      note.value = '';
      await open(openId);
      S.say('apd-message', text, 'success');
      load();
    } catch (err) {
      S.say('apd-message', err.message, 'error');
    }
  });

  // Notes
  document.getElementById('apd-note-form').addEventListener('submit', async e => {
    e.preventDefault();
    const box = document.getElementById('apd-note');
    if (!box.value.trim()) return;
    try {
      await S.api(`/api/applications/${openId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: box.value })
      });
      box.value = '';
      await open(openId);
      load();
    } catch (err) {
      S.say('apd-message', err.message, 'error');
    }
  });

  load();
});
