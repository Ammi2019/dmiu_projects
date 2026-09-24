// ----------------------
// Tab Switching
// ----------------------
const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// ----------------------
// Form Handling
// ----------------------
document.addEventListener("DOMContentLoaded", () => {
  // Student Registration
  const studentRegisterForm = document.getElementById("studentRegisterForm");
  if (studentRegisterForm) {
    studentRegisterForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = {
        name: e.target.name.value,
        email: e.target.email.value,
        password: e.target.password.value,
        date_of_birth: e.target.date_of_birth.value,
        enrollment_date: e.target.enrollment_date.value,
        department_id: e.target.department_id.value
      };

      try {
        const res = await fetch("/api/students/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData)
        });
        const data = await res.json();
        if (res.ok) {
          alert(`Registration successful! Your Student ID is ${data.student_id}`);
          window.location.href = "/student-login.html";
        } else {
          alert(data.message || "Registration failed.");
        }
      } catch (err) {
        console.error(err);
        alert("Error registering student.");
      }
    });
  }

  // Student Login
  const studentLoginForm = document.getElementById("studentLoginForm");
  if (studentLoginForm) {
    studentLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const student_id = e.target.student_id.value;
      const password = e.target.password.value;

      try {
        const res = await fetch("/api/students/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id, password })
        });
        const data = await res.json();
        if (res.ok) {
          alert("Login successful!");
          localStorage.setItem("token", data.token);
          window.location.href = data.redirect;
        } else {
          alert(data.message || "Login failed.");
        }
      } catch (err) {
        console.error(err);
        alert("Error logging in.");
      }
    });
  }

  // Administrator Login
  const adminLoginForm = document.getElementById("adminLoginForm");
  if (adminLoginForm) {
    adminLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = e.target.email.value;
      const password = e.target.password.value;

      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
          alert("Admin login successful!");
          localStorage.setItem("token", data.token);
          window.location.href = data.redirect;
        } else {
          alert(data.message || "Login failed.");
        }
      } catch (err) {
        console.error(err);
        alert("Error logging in.");
      }
    });
  }

  // Lecturer Login
  const lecturerLoginForm = document.getElementById("lecturerLoginForm");
  if (lecturerLoginForm) {
    lecturerLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = e.target.email.value;
      const password = e.target.password.value;

      try {
        const res = await fetch("/api/lecturers/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
          alert("Lecturer login successful!");
          localStorage.setItem("token", data.token);
          window.location.href = data.redirect;
        } else {
          alert(data.message || "Login failed.");
        }
      } catch (err) {
        console.error(err);
        alert("Error logging in.");
      }
    });
  }
});

