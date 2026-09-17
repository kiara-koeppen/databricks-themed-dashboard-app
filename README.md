# Themed Dashboard + Genie — Databricks App

A ready-to-clone **Databricks App** that surfaces an **AI/BI dashboard** full-screen,
adds a floating **Genie** assistant popup for natural-language Q&A over your data,
and ships with a **theme switcher** (four fun themes out of the box).

> **The whole point:** hand this repo to a customer, have them change **two IDs**
> (their dashboard + their Genie space), deploy, and it works. No code changes.

---

## What the customer changes (the only edits needed)

Edit **`app.yaml`** (preferred) — or `config.py` if you're running locally:

```yaml
env:
  - name: DASHBOARD_ID
    value: "<your published AI/BI dashboard ID>"
  - name: GENIE_SPACE_ID
    value: "<your Genie space ID>"
```

| ID | Where to find it |
|----|------------------|
| **DASHBOARD_ID** | Open your **published** dashboard. URL: `.../dashboardsv3/<DASHBOARD_ID>/published` |
| **GENIE_SPACE_ID** | Open your Genie space. URL: `.../genie/rooms/<GENIE_SPACE_ID>` |

Optional: `APP_TITLE` (header text) and `DEFAULT_THEME` (`stlukes` \| `boisestate` \| `motorcycle` \| `uidaho`).

---

## Themes

Pick from the dropdown in the top-right; the choice is remembered per browser.
You can also deep-link a theme with `?theme=<key>` (handy for demos/screenshots).

| Key | Theme | Vibe |
|-----|-------|------|
| `stlukes` | 🩺 St. Luke's | Healthcare blue + green (default) |
| `boisestate` | 🐴 Boise State | Bronco blue & orange — "The Blue" |
| `motorcycle` | 🏍️ Motorcycle | Black / chrome / throttle orange (dark) |
| `uidaho` | 🌲 University of Idaho | Vandal gold & black |

Add or edit a theme in two places: a color block in `static/styles.css`
(`:root[data-theme="<key>"] { ... }`) and a metadata entry in `static/themes.js`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Databricks App (single service)                               │
│                                                                │
│   Browser (SPA)                                                │
│   ├── <iframe> ── embeds published AI/BI dashboard ───────────►│──► AI/BI Dashboard
│   └── Genie popup ── fetch /api/genie/* ──┐                    │
│                                           ▼                    │
│   FastAPI backend (app.py)                                     │
│   ├── GET  /api/config      → dashboard embed URL + IDs        │
│   ├── POST /api/genie/ask    → start / follow-up (returns fast)│──► Genie Conversation API
│   └── GET  /api/genie/result → poll message + query result     │      (start → poll → result)
└──────────────────────────────────────────────────────────────┘
```

- **Dashboard** is embedded via iframe (`/embed/dashboardsv3/<id>`), so it always
  reflects the live published dashboard.
- **Genie** uses a **non-blocking start + poll** pattern. `/api/genie/ask` kicks off
  the question and returns immediately; the browser polls `/api/genie/result` every
  ~1.5s. This keeps every request well under the Databricks Apps **~60s proxy timeout**,
  so even long-running Genie queries never 504.
- **Auth** prefers the **signed-in user's** identity (on-behalf-of token) so Genie
  answers respect each viewer's own Unity Catalog permissions; it falls back to the
  app's service principal for local dev.

---

## File structure

```
databricks-themed-dashboard-app/
├── app.py               # FastAPI backend: serves the SPA + proxies Genie
├── config.py            # Reads DASHBOARD_ID / GENIE_SPACE_ID (env or fallback)
├── app.yaml             # Databricks Apps config — EDIT THE TWO IDs HERE
├── requirements.txt     # Python deps
├── static/
│   ├── index.html       # Single-page app shell
│   ├── styles.css       # Base layout + the four theme color blocks
│   ├── themes.js        # Theme metadata (badge, tagline, sample questions)
│   └── app.js           # Config load, theme switch, Genie ask/poll loop
└── README.md
```

---

## Prerequisites

- **Databricks CLI** v0.229+ (`databricks -v`), authenticated to your workspace
  (`databricks auth login --profile <profile>`).
- A **published** AI/BI dashboard and a **Genie space** in that workspace.
- Permission to create a Databricks App (see **Permissions** below).
- For local dev only: Python 3.11+.

---

## Deploy

From the repo root:

```bash
# 1. Set your workspace profile
export DATABRICKS_CONFIG_PROFILE=<your-profile>

# 2. Create the app (one time)
databricks apps create themed-dashboard

# 3. Sync the code to your workspace files
databricks sync . /Workspace/Users/<you>/themed-dashboard-app

# 4. Deploy
databricks apps deploy themed-dashboard \
  --source-code-path /Workspace/Users/<you>/themed-dashboard-app
```

Then open the app URL printed by the deploy command. See **Permissions** for the
grants required before Genie and the embedded dashboard will work.

> Tip: for repeatable, one-command redeploys, this can be converted to a Databricks
> Asset Bundle (DAB) once you're done iterating.

---

## Permissions — what you must set up for the app to work

The app runs as its own **service principal (SP)** and (recommended) also acts
**on behalf of the signed-in user**. Configure the following.

### 1. App service principal — resource access
Grant the app's SP (shown on the app's **Overview** page) at minimum:

| Resource | Grant | Why |
|----------|-------|-----|
| **Genie space** | `CAN RUN` | Ask questions via the Conversation API |
| **Genie's SQL warehouse** | `CAN USE` | Genie executes generated SQL here |
| **Underlying tables/metric views** | `SELECT` | So Genie's SQL can read the data |

The simplest way: in the app's **Configure → Resources** tab, add a **Genie space**
resource and a **SQL warehouse** resource. This wires the grants and lets you use
`valueFrom: genie-space` in `app.yaml` if you prefer that to hardcoding the ID.

### 2. User authorization (on-behalf-of) — required for Genie
So Genie answers respect each viewer's own permissions:

1. Open the app → **Edit** → **User authorization** → **+ Add scope** and add the
   **`genie`** scope (add `sql` too only if you later add direct SQL warehouse
   features). Save and redeploy.
   - The scope name is **`genie`**. The older `dashboards.genie` is **deprecated** —
     use `genie`. CLI equivalent: `databricks apps update <app> --json '{"user_api_scopes":["genie"]}'`.
   - Without this scope you get **`403 ... OAuth token does not have required scopes: genie`**.
2. On first open, the user (or an admin) consents to the scope.
3. If adding the scope is blocked, a workspace admin must allow it under
   **Settings → Development → Apps → "Restrict OAuth scopes for apps to selected
   values"** (set to **All APIs** or include `genie`).
4. Databricks injects the user's token as `x-forwarded-access-token`, which the
   backend uses automatically. If user auth is **not** enabled, the app falls back to
   the service principal — everyone shares its permission scope (and the SP then needs
   the grants in #1).

### 3. Dashboard embedding — required for the iframe to render
Embedding an AI/BI dashboard in an iframe has three requirements:

1. **Publish the dashboard.** Only *published* dashboards can be embedded.
2. **Approve the embedding domain.** A workspace admin must add the app's domain to
   the workspace's **approved embedding domains**
   (**Settings → Security → dashboard embedding / approved domains**). Databricks App
   URLs are on the `*.databricksapps.com` domain — add the app's specific host.
3. **Viewer sign-in.** With standard embedding, viewers sign in with their Databricks
   credentials (they already are, inside the app), and the dashboard respects either
   the publisher's credentials or per-viewer data permissions depending on how you
   published it. Third-party cookies must be allowed in the browser.

If the dashboard area stays blank, it's almost always #1 or #2 above. The app shows a
fallback card with an "Open dashboard in a new tab" link when the iframe is blocked.

### 4. App users
Give the people who should use the app **`CAN USE`** on the app itself
(**Permissions** tab). Reserve `CAN MANAGE` for developers.

---

## Local development

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABRICKS_CONFIG_PROFILE=<your-profile>   # for auth + host resolution
uvicorn app:app --reload --port 8000
# open http://127.0.0.1:8000
```

Locally there is no `x-forwarded-access-token`, so the app uses your CLI profile
credentials (service-principal-equivalent path). The embedded dashboard typically
won't render locally (embedding domains apply to the deployed app URL), but the theme
switcher and the Genie popup work against your real workspace.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dashboard area blank | Dashboard not published, or app domain not in approved embedding domains (see Permissions #3). |
| Genie: `502` / "request failed" | App SP lacks `CAN RUN` on the space or `CAN USE` on the warehouse (Permissions #1). |
| Genie: `403 ... does not have required scopes: genie` | Add the **`genie`** user-authorization scope to the app (Permissions #2). |
| Genie answers ignore user permissions | User authorization not enabled / `genie` scope not added (Permissions #2). |
| App won't start | Check `databricks apps logs themed-dashboard`; confirm `app.yaml` command is unchanged. |
| Wrong workspace | `echo $DATABRICKS_CONFIG_PROFILE`; re-run `databricks auth login`. |
