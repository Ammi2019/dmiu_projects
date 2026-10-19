// Admission application form: validation, qualification rows, drag-and-drop uploads.
document.addEventListener('DOMContentLoaded', () => {
  const MAX_FILES = 5;
  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

  const form = document.getElementById('apply-form');
  const progSelect = document.getElementById('programme');
  let programmesData = null;
  const qualList = document.getElementById('qualifications-list');
  const fileInput = document.getElementById('documents');
  const fileListEl = document.getElementById('file-list');
  const dropzone = document.getElementById('dropzone');
  const submitBtn = document.getElementById('submit-btn');
  const messageEl = document.getElementById('message');

  let selectedFiles = [];

  // ---------- helpers ----------
  function setError(id, text) {
    const el = document.getElementById(`${id}-error`);
    if (el) el.textContent = text || '';
    const input = document.getElementById(id);
    if (input) input.classList.toggle('invalid', Boolean(text));
  }

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = `message show ${type}`;
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
    const box = document.getElementById('prog-summary');
    const match = programmesData && progSelect.value ? findProgramme(progSelect.value) : null;
    if (!match) { box.hidden = true; return; }

    const { programme: p, school } = match;
    const admissionUG = programmesData.admissionFees.reduce((t, f) => t + f.ug, 0);
    const levelEl = document.getElementById('ps-level');
    levelEl.textContent = p.level === 'Bachelor' ? "Bachelor's degree" : p.level;
    levelEl.className = `level-badge level-${p.level.toLowerCase()}`;
    document.getElementById('ps-school').textContent = school.name;
    document.getElementById('ps-years').textContent = `${p.years} years`;
    document.getElementById('ps-fee').textContent = `${kwacha(p.fee)} per semester`;
    document.getElementById('ps-admission').textContent = `${kwacha(admissionUG)} (once off)`;
    box.hidden = false;
  }

  async function loadProgrammes() {
    try {
      const res = await fetch('/api/programmes');
      if (!res.ok) throw new Error();
      programmesData = await res.json();

      progSelect.innerHTML = '<option value="">Select a programme</option>';
      programmesData.schools.forEach(school => {
        const group = document.createElement('optgroup');
        group.label = school.name;
        school.programmes.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.name;
          group.appendChild(opt);
        });
        progSelect.appendChild(group);
      });

      // Pre-select the programme chosen on the Programmes tab (?programme=...)
      const wanted = new URLSearchParams(window.location.search).get('programme');
      if (wanted && findProgramme(wanted)) progSelect.value = wanted;

      showProgrammeSummary();
      updateSteps();
    } catch (err) {
      progSelect.innerHTML = '<option value="">Could not load programmes — please refresh</option>';
    }
  }

  progSelect.addEventListener('change', () => {
    setError('programme', '');
    showProgrammeSummary();
  });

  // ---------- qualifications ----------
  function addQualificationRow(focus = false) {
    const row = document.createElement('div');
    row.className = 'qual-row';
    row.innerHTML = `
      <input type="text" class="qual-subject" placeholder="e.g. Mathematics" aria-label="Subject">
      <input type="number" class="qual-result" placeholder="Result" aria-label="Result" min="0" step="1">
      <button type="button" class="icon-btn remove-qual" aria-label="Remove subject" title="Remove">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    `;
    row.querySelector('.remove-qual').addEventListener('click', () => {
      row.remove();
      if (!qualList.children.length) addQualificationRow();
      updateSteps();
    });
    row.addEventListener('input', updateSteps);
    qualList.appendChild(row);
    if (focus) row.querySelector('.qual-subject').focus();
  }

  document.getElementById('add-qualification').addEventListener('click', () => addQualificationRow(true));

  function readQualifications() {
    const quals = [];
    let incomplete = false;
    qualList.querySelectorAll('.qual-row').forEach(row => {
      const subject = row.querySelector('.qual-subject').value.trim();
      const result = row.querySelector('.qual-result').value.trim();
      row.classList.remove('invalid');
      if (subject && result !== '') quals.push({ subject, result: Number(result) });
      else if (subject || result !== '') { incomplete = true; row.classList.add('invalid'); }
    });
    return { quals, incomplete };
  }

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
        <button type="button" class="icon-btn" aria-label="Remove file">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>`;
      li.querySelector('.file-name').textContent = file.name;
      li.querySelector('button').addEventListener('click', () => {
        selectedFiles.splice(i, 1);
        renderFiles();
      });
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

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  }));
  dropzone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  // ---------- progress steps ----------
  function updateSteps() {
    const step1 = document.getElementById('name').value.trim() &&
      EMAIL_PATTERN.test(document.getElementById('email').value.trim()) && progSelect.value;
    const step2 = readQualifications().quals.length > 0;
    const step3 = selectedFiles.length > 0;
    [step1, step2, step3].forEach((done, i) => {
      document.querySelector(`.apply-step[data-step="${i + 1}"]`).classList.toggle('done', Boolean(done));
    });
  }
  form.addEventListener('input', updateSteps);
  form.addEventListener('change', updateSteps);

  // Hide the summary error once the user starts correcting things
  form.addEventListener('input', () => {
    if (messageEl.classList.contains('error')) messageEl.className = 'message';
  });
  qualList.addEventListener('input', () => {
    if (!readQualifications().incomplete) setError('qualifications', '');
  });

  // Clear a field's error as soon as the user edits it
  ['name', 'email', 'phone'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => setError(id, ''));
  });

  // ---------- validation ----------
  function validate() {
    let firstInvalid = null;
    const fail = (id, text) => { setError(id, text); firstInvalid = firstInvalid || document.getElementById(id); };

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();

    ['name', 'email', 'phone', 'programme', 'qualifications'].forEach(id => setError(id, ''));

    if (!name) fail('name', 'Please enter your full name.');
    if (!email) fail('email', 'Please enter your email address.');
    else if (!EMAIL_PATTERN.test(email)) fail('email', 'Please enter a valid email address.');
    if (phone && !PHONE_PATTERN.test(phone)) fail('phone', 'Please enter a valid phone number.');
    if (!progSelect.value) fail('programme', 'Please choose the programme you are applying for.');

    const { quals, incomplete } = readQualifications();
    if (incomplete) {
      setError('qualifications', 'Each subject needs both a name and a result.');
      firstInvalid = firstInvalid || qualList.querySelector('.qual-row.invalid input');
    } else if (!quals.length) {
      setError('qualifications', 'Please add at least one subject and result.');
      firstInvalid = firstInvalid || qualList.querySelector('input');
    }

    if (firstInvalid) firstInvalid.focus();
    return firstInvalid ? null : { name, email, phone, quals };
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

      document.getElementById('success-name').textContent = data.name;
      document.getElementById('success-email').textContent = data.email;
      document.getElementById('success-programme').textContent = progSelect.value;
      document.getElementById('success-ref').textContent =
        `APP-${String(body.application_id).padStart(5, '0')}`;
      form.hidden = true;
      document.querySelector('.apply-steps').hidden = true;
      document.getElementById('apply-success').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showMessage('Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  });

  document.getElementById('new-application').addEventListener('click', () => {
    form.reset();
    qualList.innerHTML = '';
    addQualificationRow();
    selectedFiles = [];
    renderFiles();
    messageEl.className = 'message';
    document.getElementById('apply-success').hidden = true;
    document.querySelector('.apply-steps').hidden = false;
    form.hidden = false;
    showProgrammeSummary();
    updateSteps();
  });

  // ---------- start ----------
  loadProgrammes();
  addQualificationRow();
  updateSteps();
});
