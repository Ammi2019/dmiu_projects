function showMessage(el, text, type) {
  el.textContent = text;
  el.className = 'message show ' + type;
}

function hideMessage(el) {
  el.className = 'message';
}

async function postForm(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    const messageEl = document.getElementById('message');
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideMessage(messageEl);
      submitBtn.disabled = true;

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      try {
        const { ok, text } = await postForm('/auth/login', { email, password });
        if (ok) {
          window.location.href = '/dashboard';
        } else {
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
    const messageEl = document.getElementById('message');
    const submitBtn = registerForm.querySelector('button[type="submit"]');

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideMessage(messageEl);

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirm-password').value;

      if (password !== confirmPassword) {
        showMessage(messageEl, 'Passwords do not match.', 'error');
        return;
      }

      submitBtn.disabled = true;

      try {
        const { ok, text } = await postForm('/auth/register', { name, email, password });
        if (ok) {
          showMessage(messageEl, 'Account created. Redirecting to sign in…', 'success');
          setTimeout(() => {
            window.location.href = '/login.html';
          }, 1200);
        } else {
          showMessage(messageEl, text || 'Registration failed.', 'error');
          submitBtn.disabled = false;
        }
      } catch (err) {
        showMessage(messageEl, 'Could not reach the server. Try again.', 'error');
        submitBtn.disabled = false;
      }
    });
  }
});
