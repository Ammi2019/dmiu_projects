document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('profile-form');
  if (!form) return;

  const token = localStorage.getItem('token');
  const messageEl = document.getElementById('profile-message');
  const photoPreview = document.getElementById('profile-photo-preview');
  const photoInput = document.getElementById('profile-photo-input');

  async function loadPhoto() {
    try {
      const res = await fetch('/api/profile/photo', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return; // no photo set yet — keep placeholder
      const blob = await res.blob();
      photoPreview.src = URL.createObjectURL(blob);
    } catch (err) {
      // keep placeholder on failure
    }
  }

  async function loadProfile() {
    try {
      const res = await fetch('/api/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load profile.');
      const data = await res.json();

      document.getElementById('profile-name').textContent = data.name;
      document.getElementById('profile-email').textContent = data.email;
      document.getElementById('profile-role').textContent = data.role;
      document.getElementById('job_title').value = data.job_title || '';
      document.getElementById('phone').value = data.phone || '';
      document.getElementById('office').value = data.office || '';

      if (data.photo_path) {
        loadPhoto();
      }
    } catch (err) {
      messageEl.textContent = 'Could not load profile.';
      messageEl.className = 'message show error';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const job_title = document.getElementById('job_title').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const office = document.getElementById('office').value.trim();

    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ job_title, phone, office })
      });

      const text = await res.text();
      if (res.ok) {
        messageEl.textContent = text;
        messageEl.className = 'message show success';
      } else {
        messageEl.textContent = text;
        messageEl.className = 'message show error';
      }
    } catch (err) {
      messageEl.textContent = 'Could not reach the server.';
      messageEl.className = 'message show error';
    }
  });

  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      if (!photoInput.files || photoInput.files.length === 0) return;

      const formData = new FormData();
      formData.append('photo', photoInput.files[0]);

      try {
        const res = await fetch('/api/profile/photo', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });

        const text = await res.text();
        if (res.ok) {
          messageEl.textContent = text;
          messageEl.className = 'message show success';
          loadPhoto();
        } else {
          messageEl.textContent = text;
          messageEl.className = 'message show error';
        }
      } catch (err) {
        messageEl.textContent = 'Could not reach the server.';
        messageEl.className = 'message show error';
      }
    });
  }

  loadProfile();
});
