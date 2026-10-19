// Staff dashboard → Overview: role-specific figures. Clicking a card opens its tab.
document.addEventListener('staff:loaded', async () => {
  const S = window.Staff;
  const intro = {
    administrator: 'Everything at a glance: admissions, accounts, students, staff and fees.',
    principal: 'Campus-wide figures for admissions, students, lecturers and fees.',
    registrar: 'Admissions and student records.',
    registry_clerk: 'Admissions and student records you can view and annotate.',
    dean_of_students: 'Applications and the students in your care.',
    dean_academic: 'Exam sessions, timetables and the final approval of hall tickets.',
    head_of_department: 'Admissions, students and lecturers in your school.',
    accountant: 'Fees billed, collected and outstanding.'
  };
  document.getElementById('ov-intro').textContent = intro[S.role] || '';

  try {
    const { cards, notice } = await S.api('/api/staff/overview');
    const noticeEl = document.getElementById('ov-notice');
    noticeEl.hidden = !notice;
    noticeEl.textContent = notice || '';

    document.getElementById('ov-cards').innerHTML = cards.map(c => `
      <button type="button" class="stat-card stat-link ${c.tone === 'warn' && c.value ? 'tone-warn' : ''}" data-open="${S.escapeHtml(c.tab)}">
        <span class="stat-label">${S.escapeHtml(c.label)}</span>
        <span class="stat-value">${c.money ? S.kwacha(c.value) : Number(c.value).toLocaleString('en-US')}</span>
      </button>`).join('');
  } catch (err) {
    S.say('ov-message', err.message, 'error');
  }

  document.getElementById('ov-cards').addEventListener('click', e => {
    const card = e.target.closest('[data-open]');
    if (card) S.openTab(card.dataset.open);
  });
});
