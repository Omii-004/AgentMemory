# Security Policy

## Supported Versions

| Version | Component | Status |
|---|---|---|
| `0.1.x` (`main`) | Backend API & Benchmarking Engine | Active development & supported |
| `0.1.x` (`main`) | React + TypeScript Frontend (`Milestones F1–F3`) | Active development & supported |
| `< 0.1.0` | Earlier milestone snapshots | Unsupported |

---

## Implemented Security Controls

The following protections are implemented and covered by automated tests in `backend/tests/` and `frontend/src/test/`:

### 1. Authentication & Credential Protection
- **Password Hashing:** Passwords are salted and hashed with native `bcrypt` (`backend/app/core/security.py`). Plaintext passwords are never stored or logged.
- **JWT Verification:** Protected endpoints validate HS256 JWT tokens (`python-jose`) via `get_current_user`, enforce `is_active`, and reject missing, malformed, or expired tokens with `401 Unauthorized` (`AM_ERR_UNAUTHORIZED`).
- **Generic Login Errors:** Failed logins return `"Incorrect email or password."` without revealing whether an email exists.

### 2. Multi-Tenant & Cross-Project Data Isolation
- **Strict Ownership Enforcement:** Every project, session, message, memory namespace, memory record, dataset, task, experiment, run, metric, execution trace, and report is scoped to the authenticated user (`Project.owner_id == current_user.id`) derived from the verified JWT `sub` claim.
- **Cross-Project Namespace Enforcement:** `/api/v1/projects/{project_id}/memories*` routes verify both project ownership and that `MemoryNamespace.project_id == project_id`.
- **Anti-Enumeration:** Accessing another user's resource UUID returns `404 Not Found` (`AM_ERR_NOT_FOUND`), matching nonexistent IDs.
- **Private Report Downloads:** Generated JSON/CSV reports are not mounted statically; downloads route exclusively through `GET /api/v1/reports/{report_id}/download` with ownership verification.

### 3. Benchmark, Memory Lifecycle & Logging Safeguards
- **Isolated Run Namespaces:** `BenchmarkRunner` provisions dedicated per-architecture namespaces for each run and enforces strict `namespace_id` filtering across `HistoryMemory`, `VectorMemory`, `StructuredMemory`, and `HybridMemory`.
- **Ground-Truth Separation:** `GroundTruthEvaluator` executes strictly outside memory architectures and LLM prompts.
- **Zero-Leakage Deletion (`app/memory/lifecycle.py`):** Deleting a memory transitively purges `derives_from` consolidated summaries and child records, hard-deletes embeddings, facts, versions, and relations, and scrubs canonical text to `"[REDACTED]"` while retaining content-free audit events.
- **Secret-Redacting Logs & Safe Error Envelopes:** `SafeLogFormatter` masks Bearer tokens, passwords, secrets, and API keys; global exception handlers return standardized `AM_ERR_*` JSON envelopes without exposing internal tracebacks on `500` errors.

### 4. Frontend Route Guards & Client Session Handling
- **Server-Verified Route Guards (`<ProtectedRoute />`):** Protected routes block workspace rendering until the stored JWT is verified against `GET /api/v1/auth/me` (verified in `frontend/src/test/auth-guard.test.tsx`).
- **Automatic `401` Session Invalidation:** Any `401` response from the API clears auth state via `useAuthStore.logout()`, dispatches an unauthorized event, and redirects cleanly to `/login` while discarding stale tokens.
- **Authenticated Report Blob Downloads:** Report downloads use `fetch` with `Authorization: Bearer <token>` headers rather than putting JWTs in URL query parameters or exposing unauthenticated static files.

---

## Known Limitations & Planned Hardening (Phase-2)

Before exposing this service to the public internet, note the following items currently open:

1. **Stateless Logout & Client Token Storage:** `POST /api/v1/auth/logout` relies on the client discarding its JWT (stored in browser `localStorage`); issued tokens remain valid until `ACCESS_TOKEN_EXPIRE_MINUTES` expires. Adding a server-side `revoked_tokens` table, refresh-token rotation, or `HttpOnly`/`Secure`/`SameSite` cookie transport is planned for Phase-2 hardening.
2. **Application Rate Limiting:** Auth (`/auth/register`, `/auth/login`) and compute-heavy benchmark/embedding endpoints do not yet enforce built-in API rate limits — place an API gateway or reverse-proxy rate limiter (e.g., Nginx / Caddy) in front in multi-user deployments.
3. **Unauthenticated System/Catalog Routes:** `/`, `/health`, `/docs`, `/redoc`, and `GET /api/v1/architectures` (static built-in architecture defaults, zero user data) are intentionally public. Restrict `/docs`, `/redoc`, or `/architectures` in production if required.

---

## Production Deployment Checklist

- Replace the sample `SECRET_KEY` from `.env.example` with a cryptographically random secret (at least 64 characters) and keep `.env` out of version control.
- Set `ENVIRONMENT=production`, `DEBUG=False`, and `SQL_ECHO=False`.
- Replace default development database credentials (`POSTGRES_PASSWORD`) and restrict PostgreSQL network access.
- Configure `BACKEND_CORS_ORIGINS` strictly to trusted frontend origins served over HTTPS.
- Avoid sending sensitive or regulated text to remote third-party LLM endpoints (`OpenAICompatibleLLMAdapter`) without appropriate provider data agreements; use `OllamaLLMAdapter` (local) or `MockLLMAdapter` for confidential workloads.

---

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for suspected security vulnerabilities or leaked credentials.

1. Use **GitHub Security Advisories** (**Security -> Advisories -> Report a vulnerability**) on the repository if enabled, or contact the repository maintainer privately.
2. Include the affected endpoint/component, reproduction steps, and potential impact.
3. Allow reasonable time to investigate and patch before public disclosure.