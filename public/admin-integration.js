/* Candy Admin integration (drop this file into your admin UI and include it)
   It uses BACKEND_BASE global variable or window.BACKEND_BASE
*/
const BACKEND_BASE =
  window.BACKEND_BASE ||
  window.__BACKEND_BASE__ ||
  "https://candyapp-backend.onrender.com";

/**
 * Set or change the global admin password.
 * - For first time: pass (null or "") as currentPassword
 * - For changing: provide the old password as currentPassword
 */
async function setGlobalPassword(currentPassword, newPassword) {
  const res = await fetch(BACKEND_BASE + "/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword || "",
      password: newPassword,
    }),
    credentials: "include", // ensure auth cookie is sent/received
  });
  return res.json();
}

/**
 * Log in with the global admin password.
 * This sets an auth cookie if successful.
 */
async function verifyGlobalPassword(candidatePassword) {
  const res = await fetch(BACKEND_BASE + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: candidatePassword }),
    credentials: "include",
  });
  return res.json();
}

/**
 * Get public settings (safe for client side).
 */
async function getPublicSettings() {
  const res = await fetch(BACKEND_BASE + "/settings");
  return res.json();
}

/**
 * Record a payment (normally used internally).
 */
async function recordPayment(method, amount, reference, meta) {
  const res = await fetch(BACKEND_BASE + "/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, amount, reference, meta }),
    credentials: "include",
  });
  return res.json();
}

console.log("✅ Candy admin integration loaded. BACKEND_BASE =", BACKEND_BASE);
