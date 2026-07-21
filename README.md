<img src="shared/assets/logos/school-logo.png" alt="YIC Sport School" width="96" />

# YIC Sport School — Dashboard

Internal desktop application for **Yorkshire International College**'s sport
school programs — student registration, attendance tracking, fee collection,
and a self-service parent/student portal.

Built with **Electron**, **Firebase** (Auth + Firestore), and **Chart.js**.

## Features

- **Dashboard** — roster, attendance-by-sport and monthly-income charts, a
  filterable attendance table, and per-student profiles.
- **Attendance** — register students (including adding a new sport for an
  already-registered student), and mark weekly attendance per sport.
- **Fees Ledger** — due/paid records per student and sport, a from/to-month
  filterable ledger with per-row attendance, a collection report, and Excel
  export + print.
- **Student Portal & Public Lookup** (`shared/portal.html`, `shared/lookup.html`)
  — self-service login for students/parents via Student ID + PIN to view
  attendance and fee status and manage their own profile.
- **Role-based access** — Super Admin, Administrator, and Coach roles, each
  scoped to the sections and sports relevant to them.
- **Auto-updates** — the installed desktop app checks GitHub Releases for
  new versions and installs them from the in-app Updates tab.

## Getting started

```bash
npm install
npm start        # builds shared/ into renderer/ + web/, then launches Electron
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Bundles `shared/` into `renderer/` (desktop) and `web/` (hosting) via esbuild |
| `npm run dist` | Builds an installer with electron-builder (no publish) |
| `npm run release` | Builds and publishes a new version to GitHub Releases |

## Releasing an update

1. Bump `"version"` in `package.json`.
2. In your own terminal (never shared or committed), set a GitHub token with
   `Contents: Read and write` on this repo:
   ```
   setx GH_TOKEN "your_token_here"
   ```
3. Run `npm run release`.

Every installed copy of the app checks this repo's Releases on launch, and
from its Updates tab, and installs new versions automatically.

## Project structure

- `shared/` — all application source (HTML/CSS/JS), shared between the
  Electron renderer build and the public website build.
- `main.js` / `preload.js` — Electron main process and context bridge.
- `scripts/build.js` — esbuild bundling into `renderer/` and `web/`.
- `firestore.rules` — Firestore security rules.

## License

Proprietary — see [LICENSE.md](LICENSE.md). Developed for the exclusive
internal use of Yorkshire International College.

## Developer

Mr. Sudesh Kumarasiri
Contact - 0713172922
Email- sudeshmaduwantha205@gmail.com
