
Candy App - API server (final)
------------------------------
Files added: api-server/

Endpoints:
- POST /settings       (protected by X-ADMIN-KEY env ADMIN_API_KEY)  -> set password or key/value
- GET  /settings       -> list public settings (admin_password excluded)
- POST /auth/verify    -> verify password (returns { ok: true/false })
- POST /admin/password -> backwards-compatible set password (also protected)
- GET  /admin/password -> check existence
- POST /auth/check     -> backwards-compatible verify
- POST /payments       -> create payment record (method: cash,cashapp,venmo)
- GET  /payments       -> list payments

Deployment on Render:
1. Create a new PostgreSQL DB on Render.
2. Set env var DATABASE_URL to the Render Postgres connection string.
3. (Optional but recommended) Set ADMIN_API_KEY to a strong secret to protect settings.
4. Deploy this folder as a Web Service; Render will run `npm install` and `npm start`.

Security notes:
- The /settings POST is protected by ADMIN_API_KEY if present.
- Passwords are stored hashed with bcrypt.
- For production restrict CORS to your frontend domain(s).

Generated on: 2025-09-24T10:35:28.509057Z
