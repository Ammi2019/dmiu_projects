// Student dashboard → Exams: my clearance checklist per exam session, and the hall ticket button.
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  const auth = { 'Authorization': `Bearer ${token}` };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const kwacha = n => 'K' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

  const STATUS = {
    cleared: ['ok', 'Cleared', '✓'],
    held: ['danger', 'On hold', '!'],
    pending: ['late', 'Pending', '…'],
    waiting: ['full', 'Waiting', '·'],
    na: ['full', 'Not applicable', '–']
  };
  const badge = s => `<span class="badge badge-${STATUS[s][0]}">${STATUS[s][1]}</span>`;

  let semester = null, programme = null;
  function sessionCard(x) {
    const s = x.session;
    const st = x.steps;
    const departments = ['accounts', 'advisor', 'hostel'];
    const finals = ['hod', 'dos', 'academic'];

    const deptRows = departments.map((k, i) => {
      const step = st[k];
      let remarks = step.detail ? esc(step.detail) : '';
      if (k === 'accounts') {
        remarks = `${esc(step.detail)}<br><small class="muted">Billed ${kwacha(step.charged)} · Paid ${kwacha(step.paid)}</small>`;
      }
      if (step.note) remarks += `${remarks ? '<br>' : ''}<strong>Reason:</strong> ${esc(step.note)}`;
      if (!remarks && step.status === 'pending') remarks = k === 'advisor' ? 'Waiting for your Class Advisor to clear you.' : 'Waiting for your Class Advisor, Head of Department or the Dean of Students to clear you.';
      return `
        <tr class="row-${step.status}">
          <td class="num">${i + 1}</td>
          <td>${esc(step.label)}</td>
          <td>${badge(step.status)}</td>
          <td>${step.by ? `${esc(step.by)}<br><small class="muted">${esc((step.at || '').slice(0, 10))}</small>` : (step.status === 'cleared' && step.auto ? '<small class="muted">Automatic (fees)</small>' : '–')}</td>
          <td class="wrap">${remarks || '–'}</td>
        </tr>`;
    }).join('');

    const stepper = finals.map(k => {
      const step = st[k];
      return `
        <li class="ex-stage stage-${step.status}">
          <span class="ex-dot" aria-hidden="true">${STATUS[step.status][2]}</span>
          <span class="ex-stage-text">
            <strong>${esc(step.label)}</strong>
            <small>${STATUS[step.status][1]}${step.at ? ' · ' + esc(step.at.slice(0, 10)) : ''}</small>
            ${step.note ? `<small class="ex-note">“${esc(step.note)}”</small>` : ''}
          </span>
        </li>`;
    }).join('');

    const timetable = x.timetable.map(t => `
      <tr><td>${new Date(t.exam_date + 'T00:00:00').toLocaleDateString('en-GB')}${t.start_time ? ` <small class="muted">${esc(t.start_time)}</small>` : ''}</td>
          <td><strong>${esc(t.module_code)}</strong></td><td>${esc(t.module_name)}</td></tr>`).join('');

    const nextStep = [...departments, ...finals].find(k => !['cleared', 'na'].includes(st[k].status));
    const ready = !!x.ticket_no;

    return `
      <article class="ex-card ${ready ? 'is-ready' : ''}">
        <header class="ex-card-head">
          <div>
            <p class="sa-course">${s.exam_type === 'end' ? 'End-semester examinations' : 'Mid-semester test'}</p>
            <h3>${esc(s.name)}</h3>
            <p class="sa-meta">Centre: ${esc(s.centre_name)} (${esc(s.centre_code)}) · Fees required: ${s.min_paid_pct}% paid</p>
          </div>
          <div class="ex-ticket-box">
            ${ready
              ? `<span class="badge badge-ok">Eligible · ${esc(x.ticket_no)}</span>
                 <a class="btn-cta btn-cta-sm" href="/hall-ticket.html?session=${s.session_id}" target="_blank" rel="noopener"><span class="btn-cta-label">Print Hall Ticket</span></a>`
              : `<span class="badge badge-late">Not yet eligible</span>
                 <button type="button" class="btn-cta btn-cta-sm" disabled title="Complete every clearance step first"><span class="btn-cta-label">Print Hall Ticket</span></button>
                 <small class="muted">${nextStep ? `Next: ${esc(st[nextStep].label)}` : ''}</small>`}
          </div>
        </header>

        <h4>No Due Certificate</h4>
        <div class="table-wrap">
          <table class="data-table ex-nodue">
            <thead><tr><th class="num">S.No</th><th>Department</th><th>Status</th><th>Signed by</th><th>Remarks</th></tr></thead>
            <tbody>${deptRows}</tbody>
          </table>
        </div>

        <h4>Final approval</h4>
        <ol class="ex-stepper">${stepper}</ol>

        ${x.timetable.length === 0 ? `<div class="notice notice-warn">${semester
            ? `No Semester ${esc(semester)} papers for your programme are on this timetable yet.`
            : 'Your current semester has not been recorded, so your modules can\'t be listed. Please contact the registry.'}</div>` : ''}
        <details class="ex-tt" ${x.timetable.length ? '' : 'hidden'}>
          <summary>My exam timetable — ${esc(programme || '')}${semester ? ', Semester ' + esc(semester) : ''} (${x.timetable.length} paper${x.timetable.length === 1 ? '' : 's'})</summary>
          <div class="table-wrap">
            <table class="data-table compact-table"><thead><tr><th>Date</th><th>Module code</th><th>Module name</th></tr></thead>
            <tbody>${timetable}</tbody></table>
          </div>
        </details>
      </article>`;
  }

  async function load() {
    try {
      const [res, me] = await Promise.all([
        fetch('/api/exams/mine', { headers: auth }),
        fetch('/api/students/me', { headers: auth })
      ]);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      semester = data.semester || null;
      programme = data.programme || null;
      if (me.ok) document.getElementById('se-photo').hidden = !!(await me.json()).has_photo;

      const empty = document.getElementById('se-empty');
      empty.hidden = data.sessions.length > 0;
      if (data.no_programme) empty.textContent = 'Your account has no programme recorded yet, so no exams can be shown. Please contact the registry.';
      document.getElementById('se-list').innerHTML = data.sessions.map(sessionCard).join('');
    } catch (err) {
      const el = document.getElementById('se-message');
      el.textContent = err.message || 'Could not load your exam clearance.';
      el.className = 'message show error';
    }
  }

  load();
  // Refresh when the student opens the tab, so new approvals show without reloading the page
  const tab = document.querySelector('.tab[data-tab="tab-exams"]');
  if (tab) tab.addEventListener('click', load);
});
