document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('change-password-form');
  if (!form) return;

  const messageEl = document.getElementById('password-message');
  const submitBtn = form.querySelector('button[type="submit"]');
  const token = localStorage.getItem('token');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;

    if (newPassword !== confirmNewPassword) {
      messageEl.textContent = 'New passwords do not match.';
      messageEl.className = 'message show error';
      return;
    }

    submitBtn.disabled = true;

    try {
      const res = await fetch('/auth/change-password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const text = await res.text();
      if (res.ok) {
        messageEl.textContent = text;
        messageEl.className = 'message show success';
        form.reset();
      } else {
        messageEl.textContent = text;
        messageEl.className = 'message show error';
      }
    } catch (err) {
      messageEl.textContent = 'Could not reach the server.';
      messageEl.className = 'message show error';
    } finally {
      submitBtn.disabled = false;
    }
  });
});
