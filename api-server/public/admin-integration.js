/* Candy Admin integration
   Drop this file into your admin UI and include it
   It uses BACKEND_BASE global variable or window.BACKEND_BASE
*/
const BACKEND_BASE =
  window.BACKEND_BASE || window.__BACKEND_BASE__ || "https://snakzplug-backend.onrender.com";

// --- PASSWORD MANAGEMENT ---

// Set / update global admin password (persists in Postgres)
async function setGlobalPassword(newPassword) {
  const res = await fetch(BACKEND_BASE + "/api/settings/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: newPassword }),
  });
  return res.json();
}

// Verify password at login
async function verifyGlobalPassword(candidatePassword) {
  const res = await fetch(BACKEND_BASE + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: candidatePassword }),
  });
  return res.json();
}

// Get current public settings
async function getPublicSettings() {
  const res = await fetch(BACKEND_BASE + "/api/settings");
  return res.json();
}

// --- PRODUCTS ---

// Get all products
async function getProducts() {
  const res = await fetch(BACKEND_BASE + "/api/products");
  return res.json();
}

// Add a new product
async function addProduct(name, price, stock) {
  const res = await fetch(BACKEND_BASE + "/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, price, stock }),
  });
  return res.json();
}

// Update product stock
async function updateProduct(id, stock) {
  const res = await fetch(`${BACKEND_BASE}/api/products/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stock }),
  });
  return res.json();
}

// --- PAYMENTS ---

// Record payment
async function recordPayment(method, amount, reference, meta) {
  const res = await fetch(BACKEND_BASE + "/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, amount, reference, meta }),
  });
  return res.json();
}

console.log("Candy admin integration loaded. Set window.BACKEND_BASE to your API host.");
