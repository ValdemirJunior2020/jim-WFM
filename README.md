# Jim WFM AI — Workforce Command Center

A polished **zero-license-cost**, **API-key-free** workforce-management demonstration built for a HotelPlanner-style call-center workflow. It includes center dashboards, a synthetic agent directory, shift planning, CSV reporting, a Super Admin change approval studio, and an opt-in local Ollama coding bridge.

> **Demonstration only.** Names, shifts, quality figures, staffing, and historical trend data are fictional. This version is **not** connected to a real workforce, booking, QA, payroll, telephony, or identity system. Public Netlify visitors have no actual super-admin authority or server access. In-browser edits are local to one browser. Do not use real employee data on the public demo.

## Preview in two minutes

1. Open `index.html` in a normal desktop browser, or host this folder with `python -m http.server 4173`.
2. Use the left navigation to view **Overview**, **Live Agent Status**, **Attendance & Shifts**, **Analytics & Reports**, **Super Admin AI Studio**, and **System Settings**.
3. In **AI Studio**, try **“Change the colors to electric blue”**. Review and approve the request to change the demo theme.
4. Update an example agent in the directory. The aggregate metrics refresh. Export a CSV of the synthetic results.

The standalone UI uses plain HTML, modern CSS, and browser JavaScript so it can be deployed as a static site with **no package installation** and no external API keys. React can be introduced after the demo when production requirements are agreed. Google Fonts is a purely optional cosmetic download; system-font fallbacks work offline.

## Architecture

| Layer | Choice | Cost / status |
| --- | --- | --- |
| Demo frontend | Static HTML/CSS/JavaScript | Free; offline-capable |
| Frontend hosting | Netlify static hosting | Free tier subject to account allowances |
| Domain / routing | Your Cloudflare domain | Existing domain; configuration not included |
| Local AI inference | Ollama (`qwen2.5-coder:7b` as a starter model) | No model API key; local power and hardware required |
| Backend for supervised code edits | Local Node.js `server/index.mjs` | Free; opt-in; requires admin token |
| Production database design | Self-hosted PostgreSQL or Supabase OSS | Not provisioned in demo |
| Agent orchestration inspiration | Langflow / OpenHands OSS | Not integrated or deployed in demo |
| Regression testing strategy | Playwright | Python-based browser smoke test is included below; can be extended |

These five open source tools were considered from your collection: **Ollama**, **OpenHands**, **Langflow**, **Supabase**, and **Playwright**. OpenHands and Langflow are architectural options, not secretly bundled runtimes. The demo deliberately avoids service credentials and third-party paid inference.

## Jim's change-control design

**Visual controls (working in the static demo):** Brand/title, color palette, density, module visibility, staffing thresholds, synthetic agents/shifts, CSV/JSON exports, request approval log, and browser-local persistence.

**Code changes (opt-in local bridge):** An approved person gives a source file and a request; Ollama suggests one exact-text replacement in a file allowlist (`app.js`, `styles.css`, or `index.html`). The response shows the removed and replacement text. Clicking **Approve Local File Patch** writes only to the local working copy after verifying the original file hasn't changed and running a JS syntax check when applicable. Backups and an append-only audit record are kept on the local computer. Git staging, commit, push, and Netlify deploy are **separate human-reviewed steps**. The bridge cannot execute arbitrary AI-generated shell commands.

**Not implemented:** Production SSO or role-based authentication, centralized historical storage, workforce integrations, real-time telephony, AI-generated staffing forecasts, automated Git deployment, and multi-user collaboration. These must be built before working with company data.

## Enable Ollama locally (optional)

1. Install **Node.js 22+** and [Ollama](https://github.com/ollama/ollama) on the Windows machine serving the AI.
2. Run `ollama pull qwen2.5-coder:7b` in a terminal. Choose another model in `server/.env.local` if desired; check compatibility with your GPU.
3. Double-click **`START-LOCAL-AI.bat`**. On its first run it generates `server/.env.local` with a random 256-bit bearer token, and then runs `server/index.mjs` on **127.0.0.1:8787**.
4. Find the generated token in `server/.env.local`. On a trusted local browser open **System Settings**, enter `http://127.0.0.1:8787` and paste the token to connect.
5. For a Netlify frontend running on a different machine, use a **secured HTTPS reverse proxy** such as Cloudflare Tunnel **plus Cloudflare Access**. Edit `CORS_ORIGINS` with the exact frontend origins you authorize. Do not expose local Ollama or the Node service directly or use a broad `*` CORS policy.
6. In AI Studio, add a code request, preview it, select a file, click **Draft via Ollama**, inspect the exact replacement, and explicitly approve only safe changes. Review changes with `git diff` before committing and pushing them to the GitHub repository.

**Backend security details:** It binds to `127.0.0.1` by default, requires an admin token of at least 24 characters for source changes, restricts origins, caps input sizes, uses a file allowlist, rejects stale drafts, and does not execute shell commands generated by the model. For any externally accessible deployment, add proper SSO, rate limiting, abuse protection, audit retention, and per-user permissions before enabling company data or edits.

## Publish via Netlify

[Deploy this GitHub repository to Netlify](https://app.netlify.com/start/deploy?repository=https://github.com/ValdemirJunior2020/jim-WFM)

The root `netlify.toml` builds a `dist/` folder containing **only** the four static frontend files; the local backend and its configuration are not publicly published. Connect the GitHub repository `ValdemirJunior2020/jim-WFM` in **Netlify → Add new project → Import an existing project** and select `main`. The build uses only standard shell tools, so no package installation is needed. A site is only live once Netlify confirms a successful deploy.

Suggested Cloudflare DNS: `wfm.hotelplannerqa.com` as a CNAME targeting the confirmed Netlify domain, configured in both Netlify Domain Management and Cloudflare DNS. **Do not change root `hotelplannerqa.com` or any existing app without permission.** The local Ollama bridge is a separate origin and is not hosted on Netlify.

## Validation

- `node --check app.js`
- `node --check server/index.mjs`
- `node --test tests/*.test.mjs`
- Browser verification can run with a local Playwright installation against a local HTTP server. Keep demo labels in all screens.

## Files

- `index.html`, `styles.css`, `app.js`: static interactive frontend
- `server/index.mjs`: local AI bridge
- `server/start.ps1`, `START-LOCAL-AI.bat`: Windows local-server launcher
- `server/.env.example`: private server configuration example
- `netlify.toml`: static site config and security headers
- `tests/`: smoke validation of project structure and backend defaults

## Licensing and attribution

The original demonstration code in this repository may be used internally. Dependencies referenced as design options have their own licenses. No Synerion source code, assets, or nonpublic materials were copied into the project.
