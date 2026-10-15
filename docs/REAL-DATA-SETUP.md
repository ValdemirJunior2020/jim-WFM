# Jim WFM — Private workforce data (October 2026)

## Keep employee records off public GitHub and Netlify

The frontend hosted on Netlify is a **public demo with synthetic data**. Do not paste employee spreadsheets, work passwords, customer information, or imported real rosters into the public demo or repository.

A separate local-only administrator portal is included in the Node.js bridge:
- Launch `START-LOCAL-AI.bat` on the trusted Windows machine (Node.js 22+).
- Open **http://127.0.0.1:8787/roster** on that same machine.
- Read `server/.env.local` for `ADMIN_TOKEN` and unlock with that token.
- Select the **password-free private roster JSON** supplied separately; click **Import / Merge** to load.
- Jim can add, edit, archive, restore, and permanently delete agent records. The portal requires explicit confirmations; every write creates an encrypted backup plus a PII-minimized audit entry.

**Do not commit `server/.env.local` or `server/private/`.** Both are in `.gitignore`. The roster is encrypted at rest with AES-256-GCM using a key derived from the admin token. Preserve the token securely: changing or losing it will make saved roster data unreadable. Backups are stored locally. This is local token security, **not** production SSO/multi-user role-based access; do not expose the port publicly.

## Source mapping
- **Buwelo**: `Active Agents - COL`, `Active Agents - GH`, `Active Agents - PH`. Deduplicate by center + work email. Historical `Agents Removed` is not current staff.
- **Concentrix**: `CON Master List`. Preserve both Active and On Leave. Exclude historical `Deactivated Logins`.
- **Telus**: `Active Agents` from one version; the two supplied workbooks contain the same active staff identities. Do not import twice. `Agents Removed` is separate.
- **WNS**: no roster supplied yet.

**Never import any password, PW, credential, or secret columns.** The local importer rejects keys that look like credentials. The private import file contains only staff information necessary for roster management.

## Booking lookup source
`https://www.hotelplanner.com/_Admin/Postings/FIT.htm?fit_id={FIT_ID}&SkipStats=1` represents one FIT booking detail page, **not** a real-time workforce API. It may require an authenticated HotelPlanner session. No credentials are stored or automated requests made. A real booking integration needs an authorized read-only endpoint, access specification, and server-side authentication.

## Data correctness
An active roster record does **not** prove an agent is logged in, on a call, taking breaks, or scheduled today. Telephony availability and QA scores remain synthetic in the public demo until real approved feeds are connected. In the private directory, **Active / On Leave** is roster membership only. Jim's edits modify private records, not the source company's accounts or HotelPlanner bookings.

## Security / next stage
For Jim to use the portal remotely from other devices, add company-approved identity/SSO, granular authorization, monitoring, HTTPS through a properly secured access gateway, and backups. Do **not** simply publish port 8787 or provide the raw admin token to every user.

