// Admission application form — online version of the DMI-St. Eugene University paper form (sections A–J).
document.addEventListener('DOMContentLoaded', () => {
  const MAX_FILES = 5;
  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

  const form = document.getElementById('apply-form');
  const progSelect = document.getElementById('programme');
  const secondSelect = document.getElementById('second_choice');
  const oLevelList = document.getElementById('qualifications-list');
  const aLevelList = document.getElementById('alevel-list');
  const profList = document.getElementById('professional-list');
  const fileInput = document.getElementById('documents');
  const fileListEl = document.getElementById('file-list');
  const dropzone = document.getElementById('dropzone');
  const submitBtn = document.getElementById('submit-btn');
  const messageEl = document.getElementById('message');

  let programmesData = null;
  let selectedFiles = [];

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const val = id => ($(id) ? $(id).value.trim() : '');
  const radio = name => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
  const checked = name => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

  function setError(id, text) {
    const el = $(`${id}-error`);
    if (el) el.textContent = text || '';
    const input = $(id);
    if (input) input.classList.toggle('invalid', Boolean(text));
  }

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = `message show ${type}`;
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function fullName() {
    return [val('first_name'), val('middle_name'), val('surname')].filter(Boolean).join(' ').toUpperCase();
  }

  // ---------- programmes ----------
  const kwacha = n => 'K' + Number(n).toLocaleString('en-US');

  function findProgramme(name) {
    for (const school of programmesData.schools) {
      const p = school.programmes.find(x => x.name === name);
      if (p) return { programme: p, school };
    }
    return null;
  }

  function showProgrammeSummary() {
    const box = $('prog-summary');
    const match = programmesData && progSelect.value ? findProgramme(progSelect.value) : null;
    if (!match) { box.hidden = true; return; }

    const { programme: p, school } = match;
    const admissionUG = programmesData.admissionFees.reduce((t, f) => t + f.ug, 0);
    const levelEl = $('ps-level');
    levelEl.textContent = p.level === 'Bachelor' ? "Undergraduate (Bachelor's degree)" : p.level;
    levelEl.className = `level-badge level-${p.level.toLowerCase()}`;
    $('ps-school').textContent = school.name;
    $('ps-years').textContent = `${p.years} years`;
    $('ps-fee').textContent = `${kwacha(p.fee)} per semester`;
    $('ps-admission').textContent = `${kwacha(admissionUG)} (once off)`;
    box.hidden = false;
  }

  function fillProgrammeSelect(select, firstLabel) {
    select.innerHTML = `<option value="">${firstLabel}</option>`;
    programmesData.schools.forEach(school => {
      const group = document.createElement('optgroup');
      group.label = school.name;
      school.programmes.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        group.appendChild(opt);
      });
      select.appendChild(group);
    });
  }

  async function loadProgrammes() {
    try {
      const res = await fetch('/api/programmes');
      if (!res.ok) throw new Error();
      programmesData = await res.json();
      fillProgrammeSelect(progSelect, 'Select a programme');
      fillProgrammeSelect(secondSelect, 'No second choice');

      const wanted = new URLSearchParams(window.location.search).get('programme');
      if (wanted && findProgramme(wanted)) progSelect.value = wanted;

      showProgrammeSummary();
      updateSteps();
    } catch (err) {
      progSelect.innerHTML = '<option value="">Could not load programmes — please refresh</option>';
    }
  }

  progSelect.addEventListener('change', () => { setError('programme', ''); setError('second_choice', ''); showProgrammeSummary(); });
  secondSelect.addEventListener('change', () => setError('second_choice', ''));

  // ---------- show / hide follow-up questions ----------
  function syncConditional() {
    const payer = radio('payer');
    $('sponsor-field').hidden = !payer || payer === 'Self-Sponsor';
    $('needs-field').hidden = radio('special_needs') !== 'Yes';
    $('decl-name').textContent = fullName() || '[your full name]';
  }

  // ---------- subject rows ('O' and 'A' level) ----------
  const removeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function addSubjectRow(list, focus = false) {
    const row = document.createElement('div');
    row.className = 'qual-row';
    row.innerHTML = `
      <input type="text" class="qual-subject" placeholder="e.g. Mathematics" aria-label="Subject">
      <input type="number" class="qual-result" placeholder="Grade" aria-label="Grade" min="1" max="9" step="1">
      <button type="button" class="icon-btn" aria-label="Remove subject" title="Remove">${removeIcon}</button>`;
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      if (!list.children.length) addSubjectRow(list);
      updateSteps();
    });
    list.appendChild(row);
    if (focus) row.querySelector('.qual-subject').focus();
  }

  function readSubjects(list) {
    const rows = [];
    let problem = '';
    list.querySelectorAll('.qual-row').forEach(row => {
      const subject = row.querySelector('.qual-subject').value.trim();
      const result = row.querySelector('.qual-result').value.trim();
      row.classList.remove('invalid');
      if (!subject && result === '') return;
      const grade = Number(result);
      if (!subject || result === '') { problem = 'Each subject needs both a name and a grade.'; row.classList.add('invalid'); }
      else if (!Number.isInteger(grade) || grade < 1 || grade > 9) { problem = 'Grades must be whole numbers from 1 to 9.'; row.classList.add('invalid'); }
      else rows.push({ subject, result: grade });
    });
    return { rows, problem };
  }

  document.querySelectorAll('.add-row').forEach(btn =>
    btn.addEventListener('click', () => addSubjectRow($(btn.dataset.target), true)));

  // ---------- professional qualification rows ----------
  function addProfessionalRow(focus = false) {
    const row = document.createElement('div');
    row.className = 'prof-row';
    row.innerHTML = `
      <input type="text" class="prof-institution" placeholder="Institution" aria-label="Institution">
      <input type="text" class="prof-qualification" placeholder="e.g. Certificate in ICT" aria-label="Qualification">
      <input type="month" class="prof-date" aria-label="Date obtained">
      <button type="button" class="icon-btn" aria-label="Remove qualification" title="Remove">${removeIcon}</button>`;
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      if (!profList.children.length) addProfessionalRow();
    });
    profList.appendChild(row);
    if (focus) row.querySelector('.prof-institution').focus();
  }

  function readProfessional() {
    const rows = [];
    let problem = '';
    profList.querySelectorAll('.prof-row').forEach(row => {
      const institution = row.querySelector('.prof-institution').value.trim();
      const qualification = row.querySelector('.prof-qualification').value.trim();
      const date = row.querySelector('.prof-date').value;
      row.classList.remove('invalid');
      if (!institution && !qualification && !date) return;
      if (!institution || !qualification) { problem = 'Each professional qualification needs an institution and a qualification.'; row.classList.add('invalid'); }
      else rows.push({ institution, qualification, date });
    });
    return { rows, problem };
  }

  $('add-professional').addEventListener('click', () => addProfessionalRow(true));

  // ---------- documents ----------
  function renderFiles() {
    fileListEl.innerHTML = '';
    selectedFiles.forEach((file, i) => {
      const li = document.createElement('li');
      li.className = 'file-chip';
      const kind = file.type === 'application/pdf' ? 'PDF' : 'IMG';
      li.innerHTML = `
        <span class="file-kind">${kind}</span>
        <span class="file-name"></span>
        <span class="file-size">${formatSize(file.size)}</span>
        <button type="button" class="icon-btn" aria-label="Remove file">${removeIcon}</button>`;
      li.querySelector('.file-name').textContent = file.name;
      li.querySelector('button').addEventListener('click', () => { selectedFiles.splice(i, 1); renderFiles(); });
      fileListEl.appendChild(li);
    });
    updateSteps();
  }

  function addFiles(files) {
    setError('documents', '');
    const problems = [];
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) { problems.push(`${file.name} is not a PNG, JPEG or PDF.`); continue; }
      if (file.size > MAX_SIZE) { problems.push(`${file.name} is larger than 5MB.`); continue; }
      if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) continue;
      if (selectedFiles.length >= MAX_FILES) { problems.push(`You can upload up to ${MAX_FILES} files.`); break; }
      selectedFiles.push(file);
    }
    if (problems.length) setError('documents', problems.join(' '));
    renderFiles();
  }

  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
  dropzone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  // ---------- progress steps ----------
  function updateSteps() {
    const step1 = radio('title') && val('surname') && val('first_name') && val('dob') && radio('gender') &&
      radio('marital_status') && val('nationality') && val('nrc') && val('residential_address') &&
      PHONE_PATTERN.test(val('phone')) && EMAIL_PATTERN.test(val('email')) && val('kin_name') && val('kin_phone');
    const step2 = progSelect.value && radio('intake') && radio('mode') && radio('campus') && radio('payer');
    const step3 = val('school_attended') && readSubjects(oLevelList).rows.length > 0;
    const step4 = radio('special_needs') && radio('accommodation');
    const step5 = $('declaration').checked && val('signature');
    [step1, step2, step3, step4, step5].forEach((done, i) => {
      document.querySelector(`.apply-step[data-step="${i + 1}"]`).classList.toggle('done', Boolean(done));
    });
  }

  form.addEventListener('input', () => { syncConditional(); updateSteps(); });
  form.addEventListener('change', () => { syncConditional(); updateSteps(); });

  // Clear errors as soon as the user corrects things
  form.addEventListener('input', e => {
    if (messageEl.classList.contains('error')) messageEl.className = 'message';
    if (e.target.id) setError(e.target.id, '');
  });
  form.addEventListener('change', e => {
    if (e.target.type === 'radio' || e.target.type === 'checkbox') setError(e.target.name, '');
    if (e.target.id === 'declaration') setError('declaration', '');
  });

  // ---------- validation ----------
  function ageOn(dobText) {
    const dob = new Date(dobText);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
    return age;
  }

  function validate() {
    let firstInvalid = null;
    const fail = (id, text) => {
      setError(id, text);
      const el = $(id);
      const target = el && (el.matches('input, select, textarea') ? el : el.querySelector('input'));
      firstInvalid = firstInvalid || target;
    };
    form.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
    form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

    // A. Personal details
    if (!radio('title')) fail('title', 'Please tick Mr. or Ms.');
    if (!val('surname')) fail('surname', 'Please enter your surname.');
    if (!val('first_name')) fail('first_name', 'Please enter your first name.');
    if (!val('dob')) fail('dob', 'Please enter your date of birth.');
    else if (new Date(val('dob')) > new Date() || ageOn(val('dob')) < 14) fail('dob', 'Please check your date of birth.');
    if (!radio('gender')) fail('gender', 'Please tick your gender.');
    if (!radio('marital_status')) fail('marital_status', 'Please tick your marital status.');
    if (!val('nationality')) fail('nationality', 'Please enter your nationality.');
    if (!val('nrc')) fail('nrc', 'Please enter your NRC or passport number.');
    if (!val('residential_address')) fail('residential_address', 'Please enter your residential address.');
    if (!val('phone')) fail('phone', 'Please enter your mobile number.');
    else if (!PHONE_PATTERN.test(val('phone'))) fail('phone', 'Please enter a valid mobile number.');
    if (!val('email')) fail('email', 'Please enter your email address.');
    else if (!EMAIL_PATTERN.test(val('email'))) fail('email', 'Please enter a valid email address.');
    if (!val('kin_name')) fail('kin_name', 'Please enter the name of your parent, guardian or next of kin.');
    if (!val('kin_phone')) fail('kin_phone', 'Please enter their mobile number.');
    else if (!PHONE_PATTERN.test(val('kin_phone'))) fail('kin_phone', 'Please enter a valid mobile number.');
    if (val('kin_email') && !EMAIL_PATTERN.test(val('kin_email'))) fail('kin_email', 'Please enter a valid email address.');

    // B. Programme + C. Financial support
    if (!progSelect.value) fail('programme', 'Please choose the programme you are applying for.');
    if (secondSelect.value && secondSelect.value === progSelect.value) fail('second_choice', 'Your second choice must be different from your first choice.');
    if (!radio('intake')) fail('intake', 'Please choose an intake.');
    if (!radio('mode')) fail('mode', 'Please choose a mode of study.');
    if (!radio('campus')) fail('campus', 'Please choose a campus.');
    if (!radio('payer')) fail('payer', 'Please tell us how your fees will be paid.');
    else if (radio('payer') !== 'Self-Sponsor' && !val('sponsor_details')) fail('sponsor_details', 'Please enter the name and contact number of your parent or sponsor.');

    // D. Academic details
    if (!val('school_attended')) fail('school_attended', 'Please enter the school(s) you attended.');
    const oLevel = readSubjects(oLevelList);
    if (oLevel.problem) { setError('qualifications', oLevel.problem); firstInvalid = firstInvalid || oLevelList.querySelector('.qual-row.invalid input'); }
    else if (!oLevel.rows.length) { setError('qualifications', 'Please add at least one Grade 12 subject and grade.'); firstInvalid = firstInvalid || oLevelList.querySelector('input'); }
    const aLevel = readSubjects(aLevelList);
    if (aLevel.problem) { setError('alevel', aLevel.problem); firstInvalid = firstInvalid || aLevelList.querySelector('.qual-row.invalid input'); }
    const professional = readProfessional();
    if (professional.problem) { setError('professional', professional.problem); firstInvalid = firstInvalid || profList.querySelector('.prof-row.invalid input'); }

    // E, F
    if (!radio('special_needs')) fail('special_needs', 'Please answer Yes or No.');
    else if (radio('special_needs') === 'Yes' && !val('special_needs_details')) fail('special_needs_details', 'Please describe your special needs so we can support you.');
    if (!radio('accommodation')) fail('accommodation', 'Please answer Yes or No.');

    // G. Declaration
    if (!$('declaration').checked) fail('declaration', 'Please tick the declaration to confirm your information is true.');
    if (!val('signature')) fail('signature', 'Please type your full name as your signature.');

    if (firstInvalid) { firstInvalid.focus(); return null; }

    return {
      name: fullName(),
      email: val('email'),
      phone: val('phone'),
      quals: [...oLevel.rows.map(q => ({ ...q, level: 'O' })), ...aLevel.rows.map(q => ({ ...q, level: 'A' }))],
      details: {
        title: radio('title'),
        surname: val('surname').toUpperCase(),
        first_name: val('first_name').toUpperCase(),
        middle_name: val('middle_name').toUpperCase(),
        dob: val('dob'),
        gender: radio('gender'),
        marital_status: radio('marital_status'),
        nationality: val('nationality'),
        nrc: val('nrc'),
        place_of_birth: val('place_of_birth'),
        postal_address: val('postal_address'),
        residential_address: val('residential_address'),
        kin_name: val('kin_name'),
        kin_address: val('kin_address'),
        kin_phone: val('kin_phone'),
        kin_email: val('kin_email'),
        second_choice: secondSelect.value,
        intake: radio('intake'),
        mode: radio('mode'),
        campus: radio('campus'),
        payer: radio('payer'),
        sponsor_details: radio('payer') === 'Self-Sponsor' ? '' : val('sponsor_details'),
        school_attended: val('school_attended'),
        professional: professional.rows,
        special_needs: radio('special_needs'),
        special_needs_details: radio('special_needs') === 'Yes' ? val('special_needs_details') : '',
        accommodation: radio('accommodation'),
        heard_from: checked('heard_from'),
        heard_other: val('heard_other'),
        documents_checklist: checked('doc_check'),
        signature: val('signature')
      }
    };
  }

  // ---------- submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    messageEl.className = 'message';

    const data = validate();
    if (!data) {
      showMessage('Please fix the highlighted fields.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('email', data.email);
    formData.append('phone', data.phone);
    formData.append('programme', progSelect.value);
    formData.append('qualifications', JSON.stringify(data.quals));
    formData.append('details', JSON.stringify(data.details));
    selectedFiles.forEach(file => formData.append('documents', file));

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');

    try {
      const res = await fetch('/api/applications', { method: 'POST', body: formData });
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const body = isJson ? await res.json() : { message: await res.text() };

      if (!res.ok) {
        showMessage(body.message || 'Submission failed. Please try again.', 'error');
        return;
      }

      $('success-name').textContent = data.name;
      $('success-email').textContent = data.email;
      $('success-programme').textContent = progSelect.value;
      $('success-ref').textContent = `APP-${String(body.application_id).padStart(5, '0')}`;
      form.hidden = true;
      document.querySelector('.apply-steps').hidden = true;
      $('apply-success').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showMessage('Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  });

  $('new-application').addEventListener('click', () => {
    form.reset();
    [oLevelList, aLevelList, profList].forEach(l => { l.innerHTML = ''; });
    addSubjectRow(oLevelList);
    addSubjectRow(aLevelList);
    addProfessionalRow();
    selectedFiles = [];
    renderFiles();
    messageEl.className = 'message';
    $('apply-success').hidden = true;
    document.querySelector('.apply-steps').hidden = false;
    form.hidden = false;
    syncConditional();
    showProgrammeSummary();
    updateSteps();
  });

  // ---------- start ----------
  $('sign_date').value = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  loadProgrammes();
  addSubjectRow(oLevelList);
  addSubjectRow(aLevelList);
  addProfessionalRow();
  syncConditional();
  updateSteps();
});
