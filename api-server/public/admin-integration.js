
/* Candy Admin integration (drop this file into your admin UI and include it)
   It uses BACKEND_BASE global variable or window.BACKEND_BASE
*/
const BACKEND_BASE = window.BACKEND_BASE || window.__BACKEND_BASE__ || 'https://snakzplug-backend.onrender.com';

async function setGlobalPassword(adminApiKey, newPassword) {
  const res = await fetch(BACKEND_BASE + "/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminApiKey
    },
    body: JSON.stringify({ password: newPassword })
  });
  return res.json();
}

async function verifyGlobalPassword(candidatePassword) {
  const res = await fetch(BACKEND_BASE + "/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: candidatePassword })
  });
  return res.json();
}

async function getPublicSettings() {
  const res = await fetch(BACKEND_BASE + "/settings");
  return res.json();
}

async function recordPayment(method, amount, reference, meta) {
  const res = await fetch(BACKEND_BASE + "/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, amount, reference, meta })
  });
  return res.json();
}

console.log('Candy admin integration loaded. Set window.BACKEND_BASE to your API host.');
