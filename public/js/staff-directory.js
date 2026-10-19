// Staff dashboard → Students + Lecturers directories.
document.addEventListener('staff:loaded', async () => {
  const S = window.Staff;
  const esc = S.escapeHtml;
  const me = S.me;
  let data = { schools: [] };
  try { data = await S.programmes(); } catch (e) { /* filters fall back to empty */ }

  // ================= Students =================
  if (document.getElementById('tab-students')) {
    const schoolSel = document.getElementById('st-school');
    const progSel = document.getElementById('st-programme');

    // A Head of Department is locked to their school
    if (me.school_scoped) {
      document.getElementById('st-school-wrap').hidden = true;
      document.getElementById('st-intro').textContent = me.school ? `Students in the ${me.school}.` : '';
    } else {
      schoolSel.innerHTML = '<option value="">All schools</option>' +
        data.schools.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    }

    function fillProgrammes() {
      const school = me.school_scoped ? me.school : schoolSel.value;
      const list = data.schools.filter(s => !school || s.name === school).flatMap(s => s.programmes);
      progSel.innerHTML = '<option value="">All programmes</option>' +
        list.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    }
    fillProgrammes();

    const contacts = me.can.viewStudentContacts;
    const fees = me.can.viewFees;
    document.querySelector('#st-table thead').innerHTML = `
      <tr>
        <th>Student</th><th>Programme</th><th>Joined</th>
        ${contacts ? '<th>Phone</th><th>Next of kin</th>' : ''}
        ${fees ? '<th class="num">Fee balance</th>' : ''}
      </tr>`;

    async function loadStudents() {
      S.hush('st-message');
      const params = new URLSearchParams();
      if (!me.school_scoped && schoolSel.value) params.set('school', schoolSel.value);
      if (progSel.value) params.set('programme', progSel.value);
      const q = document.getElementById('st-search').value.trim();
      if (q) params.set('q', q);
      try {
        const { students } = await S.api(`/api/staff/students?${params}`);
        document.getElementById('st-empty').hidden = students.length > 0;
        document.getElementById('st-count').textContent = students.length ? `${students.length} student${students.length === 1 ? '' : 's'}` : '';
        document.querySelector('#st-table tbody').innerHTML = students.map(s => `
          <tr>
            <td><strong>${esc(s.name)}</strong><br><small>ID ${esc(s.student_id)} · ${esc(s.email)}</small></td>
            <td>${esc(s.programme || '–')}<br><small class="muted">${esc(s.school || '')}</small></td>
            <td>${esc(s.enrollment_date || '–')}</td>
            ${contacts ? `<td>${esc(s.phone || '–')}</td><td class="wrap">${s.next_of_kin_name ? `${esc(s.next_of_kin_name)}<br><small>${esc(s.next_of_kin_phone || '')}</small>` : '–'}</td>` : ''}
            ${fees ? `<td class="num ${Number(s.balance) > 0 ? 'owing' : ''}">${S.kwacha(s.balance)}</td>` : ''}
          </tr>`).join('');
      } catch (err) {
        S.say('st-message', err.message, 'error');
      }
    }

    schoolSel.addEventListener('change', () => { fillProgrammes(); loadStudents(); });
    progSel.addEventListener('change', loadStudents);
    document.getElementById('st-search').addEventListener('input', S.debounce(loadStudents));
    loadStudents();
  }

  // ================= Lecturers =================
  if (document.getElementById('tab-lecturers')) {
    document.getElementById('lc-intro').textContent = me.school_scoped && me.school
      ? `Lecturers in the ${me.school}, with how many assignments and result sheets each has set up.`
      : 'All lecturers, with how many assignments and result sheets each has set up.';
    try {
      const { lecturers } = await S.api('/api/staff/lecturers');
      document.getElementById('lc-empty').hidden = lecturers.length > 0;
      document.querySelector('#lc-table tbody').innerHTML = lecturers.map(l => `
        <tr>
          <td><strong>${esc(l.name)}</strong><br><small>${esc(l.email)}${l.phone ? ' · ' + esc(l.phone) : ''}</small></td>
          <td>${l.school ? esc(l.school) : '<span class="muted">Not set</span>'}</td>
          <td class="wrap">${esc([l.qualification, l.specialization].filter(Boolean).join(' · ') || '–')}</td>
          <td>${esc(l.office || '–')}</td>
          <td class="num">${Number(l.assignments_posted)}</td>
          <td class="num">${Number(l.result_sheets)}</td>
        </tr>`).join('');
    } catch (err) {
      S.say('lc-message', err.message, 'error');
    }
  }
});
