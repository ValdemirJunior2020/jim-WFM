# Jim WFM AI — Run local Ollama and connect the browser (Windows)

This guide works with free software and no paid AI API keys.

## 1. Install AI on your own PC

- Install Node.js 22 or newer: https://nodejs.org/
- Install Ollama for Windows: https://ollama.com/download/windows
- Open PowerShell and run `ollama pull qwen2.5-coder:7b`
- Run `ollama list` to confirm the model appears

A GPU is optional but improves speed if supported by your Ollama build. CPU mode can be slower.

## 2. Start Jim WFM's local bridge

- Download the latest repository code to your Windows computer (or `git pull`).
- Run **START-LOCAL-AI.bat** from the project root.
- The launcher creates `server/.env.local` with a random `ADMIN_TOKEN` and a **separate** `ROSTER_VAULT_KEY` for Jim's private agent passwords. Neither key should be shared or committed.
- Keep the command window running while using the AI. The server listens on `127.0.0.1:8787` only.
- Open `http://127.0.0.1:8787/api/health`. Look for `bridge:online`, `ollama:online`, and `modelInstalled:true`.

If Ollama is offline, launch the Ollama Windows app; run `ollama serve` if needed. If the model is missing, run `ollama pull qwen2.5-coder:7b`.

## 3. Connect the frontend on that SAME Windows computer

- Use `START-DEMO.bat` for the local frontend, or, **once an actual Netlify deployment has succeeded**, open the Jim WFM Netlify site.
- Navigate to **System Settings → Local Ollama Bridge**.
- Set **Backend address** to `http://127.0.0.1:8787`.
- Copy `ADMIN_TOKEN` from `server/.env.local` into the private admin-token field; click **Connect to Ollama Bridge**.
- The browser now queries `/api/auth-check`, which verifies the token and Ollama model. The plain health endpoint alone does not authorize code changes.
- In **Super Admin AI Studio** ask for a small code change and review the proposed patch before approval. The AI does **not** push GitHub or deploy Netlify automatically.

If the Netlify browser cannot access loopback because of browser local-network permissions, use the local `START-DEMO.bat` frontend for initial setup rather than opening the AI bridge to the internet.

## 4. Remote Netlify browsers / Cloudflare

The browser on another computer cannot use `127.0.0.1` to reach your Windows PC. To enable access for Jim remotely, a future release must add a secure **HTTPS** bridge such as an authenticated Cloudflare Tunnel + Cloudflare Access, a Jim-only identity flow, validated CORS and CSRF protections, and a session-based authorization design. Never expose Ollama port 11434, the Jim WFM bridge on 8787, or the encrypted roster/password vault publicly. The current bridge is configured for loopback-only access and is **not remote-production-ready**.

The Netlify frontend is public demo software until you configure company-approved authentication and private employee-data storage. Live staff records, telephony status, and original passwords must not be uploaded to Netlify or GitHub.

## 5. Jim-only credential vault

- Open `http://127.0.0.1:8787/roster` on the trusted PC.
- Unlock the directory with `ADMIN_TOKEN`.
- Open an employee's **Password** action to set, reveal for 15 seconds, or delete a password.
- Supply the separate `ROSTER_VAULT_KEY` from `server/.env.local`. The roster API only returns `hasPassword`, never saved passwords. Secrets are encrypted separately in `server/private/password-vault.enc`.
- Keep a safe backup of `server/.env.local`, `server/private/roster.enc`, and `server/private/password-vault.enc`. Losing or changing either key may make encrypted data unrecoverable.
- Previously generated password-free roster JSON contains **no** passwords, so importing it cannot restore original account passwords. The password vault starts empty until Jim enters them through the private portal.
