// Staff dashboard → Announcements: send important information as notifications.
document.addEventListener('staff:loaded', async () => {
  if (!document.getElementById('tab-announce')) return;
  const S = window.Staff;
  const esc = S.escapeHtml;
  const me = S.me;
  let data = { schools: [] };
  try { data = await S.programmes(); } catch (e) { /* ignore */ }

  const audience = document.getElementById('an-audience');
  const schoolSel = document.getElementById('an-school');
  const progSel = document.getElementById('an-programme');

  // A Head of Department always sends to their own school
  if (me.school_scoped) {
    schoolSel.innerHTML = `<option value="${esc(me.school || '')}">${esc(me.school || 'Not assigned')}</option>`;
    schoolSel.disabled = true;
    document.getElementById('an-intro').textContent += ` You can send to people in the ${me.school || 'school you are assigned to'}.`;
  } else {
    schoolSel.innerHTML = '<option value="">All schools</option>' +
      data.schools.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
  }

  function fillProgrammes() {
    const school = schoolSel.value;
    const list = data.schools.filter(s => !school || s.name === school).flatMap(s => s.programmes);
    progSel.innerHTML = '<option value="">All programmes</option>' +
      list.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  }
  function updateFields() {
    // A programme only makes sense for students
    document.getElementById('an-programme-field').hidden = audience.value !== 'students';
    if (audience.value !== 'students') progSel.value = '';
  }
  fillProgrammes();
  updateFields();
  schoolSel.addEventListener('change', fillProgrammes);
  audience.addEventListener('change', updateFields);

  const bodyEl = document.getElementById('an-body');
  bodyEl.addEventListener('input', () => { document.getElementById('an-count').textContent = bodyEl.value.length; });

  const AUD = { students: 'Students', lecturers: 'Lecturers', staff: 'Staff', everyone: 'Everyone' };

  async function loadList() {
    try {
      const { announcements } = await S.api('/api/notifications/announcements');
      document.getElementById('an-empty').hidden = announcements.length > 0;
      document.getElementById('an-list').innerHTML = announcements.map(a => `
        <article class="an-card">
          <header>
            <strong>${esc(a.title)}</strong>
            <small>${esc(a.created_at)}</small>
          </header>
          <p>${esc(a.body)}</p>
          <footer>
            <span class="badge badge-grade">${esc(AUD[a.audience] || a.audience)}${a.programme ? ' · ' + esc(a.programme) : a.school ? ' · ' + esc(a.school) : ''}</span>
            <small class="muted">Sent by ${esc(a.sender)} to ${Number(a.recipients)} ${Number(a.recipients) === 1 ? 'person' : 'people'}</small>
          </footer>
        </article>`).join('');
    } catch (err) {
      S.say('an-message', err.message, 'error');
    }
  }

  document.getElementById('an-form').addEventListener('submit', async e => {
    e.preventDefault();
    S.hush('an-message');
    const payload = {
      audience: audience.value,
      school: schoolSel.value,
      programme: audience.value === 'students' ? progSel.value : '',
      title: document.getElementById('an-title').value.trim(),
      body: bodyEl.value.trim()
    };
    if (!payload.title) return S.say('an-message', 'Enter a title.', 'error');
    if (!payload.body) return S.say('an-message', 'Write the message.', 'error');
    const who = payload.programme || payload.school || 'all schools';
    if (!confirm(`Send "${payload.title}" to ${AUD[payload.audience].toLowerCase()} — ${who}?`)) return;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      S.say('an-message', await S.api('/api/notifications/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }), 'success');
      document.getElementById('an-title').value = '';
      bodyEl.value = '';
      document.getElementById('an-count').textContent = '0';
      loadList();
    } catch (err) {
      S.say('an-message', err.message, 'error');
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });

  loadList();
});
