# CodSec SOAR Evaluator

## Overview

This repository contains a full-stack application:
- `backend/`: Python FastAPI app
- `frontend/`: React app (Vite)
- `docker-compose.yml`: local container orchestration
- `Makefile`: convenient commands for dev, Docker, and testing

## Requirements

- Docker + Docker Compose
- Node.js (for frontend dev mode)
- Python 3.10+ (for backend dev mode)
- `make` (optional, for convenience commands)

## Setup

### 1. Clone repository

```bash
git clone <repo-url>
cd soar-pulse
```

### 2. Backend venv (optional, local dev)

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# or `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cd ..
```

### 3. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Run

### Option A: Docker (recommended)

Build + start:

```bash
make build
make up
```

Or two steps directly:

```bash
docker compose build --no-cache
docker compose up -d
```

Check status:

```bash
make status
```

Stop:

```bash
make down
```

### Option B: Local dev (no Docker)

Start the backend + frontend in watch mode:

```bash
make dev
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173
- API docs: http://localhost:8000/docs

## Useful make targets

- `make help` - show commands
- `make logs` - tail all container logs
- `make logs-backend` - backend logs only
- `make logs-frontend` - frontend logs only
- `make clean` - stop containers, remove volumes/images
- `make shell-backend` - shell in backend container
- `make shell-frontend` - shell in frontend container
- `make prod-build` - production image build
- `make prod-up` - start production stack

## Testing

Backend tests:

```bash
make test-backend
```

API smoke test (must be running):

```bash
make test-api
```

## Endpoints

- Health: `GET /api/health`
- Overview: `GET /api/overview`

## Notes

- On Windows, use PowerShell for `make` with appropriate path separators.
- If `make` is unavailable, use direct `docker compose` or `npm`/`python` commands above.
