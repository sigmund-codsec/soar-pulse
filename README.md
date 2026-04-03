# CODSEC Pulse — Google Chronicle SOAR Assessment

A full-stack dashboard for evaluating a client's Google Chronicle SOAR (Siemplify) deployment. Designed for MSSP use: connects directly to the Chronicle SOAR API and surfaces playbooks, cases, connectors, users, agents, and more in a single read-only assessment view.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, httpx (async) |
| Frontend | React 18, Vite, Recharts, Lucide Icons |
| Proxy | Nginx (serves SPA + proxies `/api` to FastAPI) |
| Orchestration | Docker Compose |
| Cache | Redis (optional, reserved for future rate-limit handling) |

## Features

### Dashboard Tabs

| Tab | Description |
|---|---|
| **Overview** | Summary stats (total playbooks, cases, avg MTTR, automation rate), case volume trend chart, maturity score ring |
| **Playbooks** | Full playbook inventory with integration tags, step counts, type, category, and last modified date |
| **Cases** | 30-day case summary with severity and status breakdowns |
| **Connectors** | All connector cards grouped by integration |
| **Webhooks** | Webhook list with environment and enabled state |
| **Environments** | Environment names configured in the SOAR platform |
| **Agents** | Agent list with live/failed status and environment assignments |
| **Users** | User accounts with roles, provider, environments, and disabled state |
| **Instances** | Integration instances with remote flag |
| **Jobs** | Scheduled jobs with enabled and custom flags |
| **IDE** | Integration definitions with custom flag and action list |
| **Findings** | Automated assessment findings flagged from the environment scan |

### Table UX (all data tabs)

- **Sortable columns** — click any column header to sort asc/desc; active column highlighted
- **25 rows per page** with first / prev / page-numbers / next / last pagination
- **Search bar** — filters by relevant text fields per tab
- **Status / boolean filters** — tab-appropriate filter buttons (e.g. Active/Disabled, Enabled, Remote, Custom)
- **Result count** shown in filter bar and pagination footer
- **Hover highlight** on each row

### Loading & UX

- **Global progress bar** — gradient bar fixed at the top of the viewport, fills as each of the 14 parallel API calls completes
- **Refresh button** — re-fetches all data; spinner animates while any request is in flight
- **Per-tab error states** with retry button
- Auto-loads all data on mount — no login screen required

### Playbooks (detail)

- Integration tags extracted from each playbook's steps via `GetWorkflowFullInfoByIdentifier`
- Step count per playbook
- Status sourced from `isEnabled` field in detail response
- All 231+ playbook detail requests run fully concurrently (`asyncio.gather`)

## API Endpoints (Backend)

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/overview` | Aggregate summary stats |
| GET | `/api/playbooks` | All playbooks with steps and integrations |
| GET | `/api/cases` | Case list (last N days, filterable) |
| GET | `/api/cases/trends` | Monthly case volume trends |
| GET | `/api/connectors` | Connector cards grouped by integration |
| GET | `/api/webhooks` | Webhook list |
| GET | `/api/environments` | Environment names |
| GET | `/api/agents` | Agent list with status |
| GET | `/api/api-keys` | API key list |
| GET | `/api/users` | User accounts |
| GET | `/api/integration-instances` | Integration instance list |
| GET | `/api/jobs` | Scheduled job list |
| GET | `/api/ide` | IDE integration definitions |
| GET | `/api/findings` | Automated assessment findings |

Interactive docs: `http://localhost:8000/docs`

## Configuration

Create `backend/.env`:

```env
# Siemplify external API key (UUID AppKey)
CHRONICLE_API_KEY=<your-app-key-uuid>

# Chronicle v1alpha Bearer token (JWT)
CHRONICLE_BEARER_TOKEN=<your-bearer-token>

# SOAR host (no https://)
CHRONICLE_SOAR_HOST=<tenant>.siemplify-soar.com

# Chronicle project details
CHRONICLE_PROJECT_ID=<project-id>
CHRONICLE_REGION=<region>          # e.g. eu, us
CHRONICLE_INSTANCE_ID=<instance-uuid>

# CORS origin for the frontend
FRONTEND_URL=http://localhost:3000
```

`backend/.env` is gitignored — never commit credentials.

## Setup & Run

### Requirements

- Docker + Docker Compose
- Node.js 20+ (frontend local dev only)
- Python 3.11+ (backend local dev only)

### Docker (recommended)

```bash
# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

Access the dashboard at **http://localhost:3000**.

### Local dev (no Docker)

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

### Makefile shortcuts

```bash
make build          # build Docker images
make up             # start containers
make down           # stop containers
make logs           # tail all logs
make logs-backend   # backend logs only
make logs-frontend  # frontend logs only
make status         # container status
make shell-backend  # shell into backend container
make clean          # stop and remove volumes/images
```

## Architecture

```
Browser
  └── http://localhost:3000
        └── Nginx (frontend container)
              ├── /           → React SPA (static files)
              └── /api/*      → proxy → FastAPI (backend container :8000)
                                    └── Chronicle SOAR API (external)
```

All Chronicle API calls are made server-side from the FastAPI backend. The browser never contacts the SOAR host directly. Credentials stay in `backend/.env` and are never exposed to the frontend.

## Security Notes

- Read-only: no write operations are performed against the Chronicle API
- Credentials are environment variables, not hardcoded
- Nginx security headers: `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy`
- Static assets served with `immutable` cache headers; `index.html` is not cached
- `.env` and `.claude/` directories are gitignored
