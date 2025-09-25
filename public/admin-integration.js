/* adminIntegration.js */
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
  try {
    const res = await fetch(BACKEND_BASE + "/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword || "",
        password: newPassword,
      }),
      credentials: "include", // ensure cookie is sent/received
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Log in with the global admin password.
 * This sets an auth cookie if successful.
 */
async function verifyGlobalPassword(candidatePassword) {
  try {
    const res = await fetch(BACKEND_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: candidatePassword }),
      credentials: "include",
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get public settings (safe for client side).
 */
async function getPublicSettings() {
  try {
    const res = await fetch(BACKEND_BASE + "/settings");
    const data = await res.json().catch(()=>({}));
    return data;
  } catch (err) {
    return { ok:false, error: err.message };
  }
}

console.log("✅ Candy admin integration loaded. BACKEND_BASE =", BACKEND_BASE);
