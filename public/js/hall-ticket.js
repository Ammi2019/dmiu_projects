// Printable hall ticket. Only works for the logged-in student, and only once the ticket is issued.
(async function () {
  const token = localStorage.getItem('token');
  if (!token || localStorage.getItem('role') !== 'student') {
    window.location.href = '/login.html';
    return;
  }
  const auth = { 'Authorization': `Bearer ${token}` };
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fail = msg => { $('ht-error').textContent = msg; $('ht-error').hidden = false; };

  const sessionId = new URLSearchParams(location.search).get('session');
  if (!sessionId) return fail('No exam session chosen. Open your hall ticket from the Exams tab.');

  try {
    const res = await fetch(`/api/exams/mine/${encodeURIComponent(sessionId)}/ticket`, { headers: auth });
    if (res.status === 401) { localStorage.clear(); window.location.href = '/login.html'; return; }
    if (!res.ok) return fail(await res.text());
    const t = await res.json();
    const s = t.student;

    // Month + year of the first paper, e.g. "October-2026"
    const first = t.timetable[0] ? new Date(t.timetable[0].exam_date + 'T00:00:00') : new Date();
    const when = `${first.toLocaleString('en-GB', { month: 'long' })}-${first.getFullYear()}`;
    $('ht-session').textContent = `${t.session.exam_type === 'end' ? 'END SEMESTER EXAMINATIONS' : 'MID SEMESTER TEST'} – ${when}`;
    document.title = `Hall Ticket ${t.ticket_no} — ${s.name}`;

    $('ht-reg').textContent = s.reg_no || String(s.student_id);
    $('ht-sem').textContent = s.current_semester || '–';
    $('ht-name').textContent = s.name;
    $('ht-programme').textContent = s.programme || '';
    $('ht-centre').textContent = t.session.centre_name;
    $('ht-code').textContent = t.session.centre_code;
    $('ht-no').textContent = t.ticket_no;
    $('ht-issued').textContent = `${t.ticket_no} · ${new Date(t.issued_at.replace(' ', 'T')).toLocaleDateString('en-GB')}`;

    $('ht-rows').innerHTML = t.timetable.map(p => `
      <tr>
        <td>${new Date(p.exam_date + 'T00:00:00').toLocaleDateString('en-GB').replace(/\//g, '.')}${p.start_time ? `<br><small>${esc(p.start_time)}</small>` : ''}</td>
        <td class="ht-center">${esc(p.module_code)}</td>
        <td class="ht-caps">${esc(p.module_name)}</td>
        <td></td>
      </tr>`).join('');

    if (s.has_photo) {
      const r = await fetch('/api/students/me/photo', { headers: auth });
      if (r.ok) {
        $('ht-photo').src = URL.createObjectURL(await r.blob());
        $('ht-photo').hidden = false;
        $('ht-photo-ph').hidden = true;
      }
    }

    $('ht-ticket').hidden = false;
    $('ht-instr').hidden = false;
    const btn = $('ht-print');
    btn.disabled = false;
    btn.addEventListener('click', () => window.print());
  } catch (err) {
    fail('Could not load your hall ticket. Check your connection and try again.');
  }
})();
