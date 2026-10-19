function showMessage(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = 'message show ' + type;
}

function hideMessage(el) {
  if (!el) return;
  el.className = 'message';
}

function redirectForRole(role) {
  if (role === 'class_teacher' || role === 'lecturer') {
    window.location.href = '/lecturer.html';
  } else if (role === 'student') {
    window.location.href = '/student.html';
  } else {
    // administrator, head_of_department, principal, dean_of_students, accountant, registrar, registry_clerk
    // all share the role-aware staff dashboard
    window.location.href = '/staff.html';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const messageEl = document.getElementById('message');

  if (loginForm) {
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const PORTAL_TITLES = { student: 'Student Login', lecturer: 'Lecturer Login', staff: 'Administration Login' };
    const titleEl = document.getElementById('login-title');
    const portalRadios = loginForm.querySelectorAll('input[name="portal"]');

    function setPortal(portal) {
      if (!PORTAL_TITLES[portal]) return;
      portalRadios.forEach(r => { r.checked = r.value === portal; });
      if (titleEl) titleEl.textContent = PORTAL_TITLES[portal];
      document.title = `${PORTAL_TITLES[portal]} — DMISEU Chipata Campus`;
    }

    // Pre-select the portal chosen on the home page (?portal=lecturer etc.)
    setPortal(new URLSearchParams(window.location.search).get('portal') || 'student');
    portalRadios.forEach(r => r.addEventListener('change', () => {
      setPortal(r.value);
      hideMessage(messageEl);
    }));

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideMessage(messageEl);
      submitBtn.disabled = true;

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const portal = loginForm.querySelector('input[name="portal"]:checked').value;

      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, portal })
        });

        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('token', data.token);
          localStorage.setItem('role', data.role);
          localStorage.setItem('name', data.name);
          redirectForRole(data.role);
        } else {
          const text = await res.text();
          showMessage(messageEl, text || 'Sign in failed.', 'error');
        }
      } catch (err) {
        showMessage(messageEl, 'Could not reach the server. Try again.', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  if (registerForm) {
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    const studentFields = document.getElementById('student-fields');
    const schoolSelect = document.getElementById('school');
    const programmeSelect = document.getElementById('programme');
    const programmeHint = document.getElementById('programme-hint');
    const lecturerFields = document.getElementById('lecturer-fields');
    const lecturerSchoolSelect = document.getElementById('lecturer-school');
    const kwacha = n => 'K' + Number(n).toLocaleString('en-US');
    let schools = [];

    const accountType = () => registerForm.querySelector('input[name="account_type"]:checked').value;

    // Show school/programme only when registering as a student
    function applyAccountType() {
      const isStudent = accountType() === 'student';
      const isLecturer = accountType() === 'lecturer';
      studentFields.hidden = !isStudent;
      schoolSelect.required = isStudent;
      programmeSelect.required = isStudent;
      lecturerFields.hidden = !isLecturer;
      lecturerSchoolSelect.required = isLecturer;
      hideMessage(messageEl);
    }
    registerForm.querySelectorAll('input[name="account_type"]').forEach(r => r.addEventListener('change', applyAccountType));

    function fillProgrammes() {
      const school = schools.find(s => s.name === schoolSelect.value);
      programmeHint.textContent = '';
      if (!school) {
        programmeSelect.innerHTML = '<option value="">Choose a school first</option>';
        programmeSelect.disabled = true;
        return;
      }
      programmeSelect.innerHTML = '<option value="">Select a programme</option>' + school.programmes
        .map(p => `<option value="${p.name.replace(/"/g, '&quot;')}">${p.name.replace(/</g, '&lt;')}</option>`)
        .join('');
      programmeSelect.disabled = false;
    }

    function showProgrammeHint() {
      const school = schools.find(s => s.name === schoolSelect.value);
      const p = school && school.programmes.find(x => x.name === programmeSelect.value);
      programmeHint.textContent = p
        ? `${p.level === 'Bachelor' ? "Bachelor's degree" : 'Diploma'} · ${p.years} years · ${kwacha(p.fee)} per semester`
        : '';
    }

    schoolSelect.addEventListener('change', fillProgrammes);
    programmeSelect.addEventListener('change', showProgrammeHint);

    (async function loadSchools() {
      try {
        const res = await fetch('/api/programmes');
        if (!res.ok) throw new Error();
        schools = (await res.json()).schools;
        const schoolOptions = schools
          .map(s => `<option value="${s.name.replace(/"/g, '&quot;')}">${s.name.replace(/</g, '&lt;')}</option>`)
          .join('');
        schoolSelect.innerHTML = '<option value="">Select your school</option>' + schoolOptions;
        lecturerSchoolSelect.innerHTML = '<option value="">Select a school</option>' + schoolOptions;
      } catch (err) {
        schoolSelect.innerHTML = '<option value="">Could not load schools — please refresh</option>';
        lecturerSchoolSelect.innerHTML = schoolSelect.innerHTML;
      }
    })();

    applyAccountType();

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideMessage(messageEl);

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirm-password').value;
      const type = accountType();

      if (!name || !email || !password) {
        showMessage(messageEl, 'Please fill in your name, email and password.', 'error');
        return;
      }
      if (type === 'student' && !schoolSelect.value) {
        showMessage(messageEl, 'Please choose your school.', 'error');
        schoolSelect.focus();
        return;
      }
      if (type === 'student' && !programmeSelect.value) {
        showMessage(messageEl, 'Please choose your programme.', 'error');
        programmeSelect.focus();
        return;
      }
      if (type === 'lecturer' && !lecturerSchoolSelect.value) {
        showMessage(messageEl, 'Please choose the school you teach in.', 'error');
        lecturerSchoolSelect.focus();
        return;
      }
      if (password.length < 8) {
        showMessage(messageEl, 'Password must be at least 8 characters.', 'error');
        return;
      }
      if (password !== confirmPassword) {
        showMessage(messageEl, 'Passwords do not match.', 'error');
        return;
      }

      const body = { name, email, password, account_type: type };
      if (type === 'student') {
        body.school = schoolSelect.value;
        body.programme = programmeSelect.value;
      }
      if (type === 'lecturer') body.school = lecturerSchoolSelect.value;

      submitBtn.disabled = true;
      submitBtn.classList.add('loading');

      try {
        const res = await fetch('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const text = await res.text();
        if (res.ok) {
          showMessage(messageEl, text, 'success');
          registerForm.querySelectorAll('input, select').forEach(el => { el.disabled = true; });
          submitBtn.classList.remove('loading');
          return; // keep the button disabled after success
        }
        showMessage(messageEl, text || 'Registration failed.', 'error');
      } catch (err) {
        showMessage(messageEl, 'Could not reach the server. Try again.', 'error');
      }
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    });
  }
});
