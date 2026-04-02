# ── CodSec SOAR Evaluator — Makefile ──
# Quick commands for development and deployment

.PHONY: help dev build up down logs restart clean status test

# Default target
help: ## Show this help
	@echo ""
	@echo "  ⚡ CodSec SOAR Evaluator"
	@echo "  ─────────────────────────"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ── Development ──

dev: ## Start backend + frontend in dev mode (no Docker)
	@echo "Starting backend..."
	cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000 &
	@echo "Starting frontend..."
	cd frontend && npm run dev &
	@echo "✅ Backend: http://localhost:8000  Frontend: http://localhost:5173"

# ── Docker ──

build: ## Build all Docker images
	docker compose build --no-cache

up: ## Start all containers (detached)
	docker compose up -d
	@echo ""
	@echo "  ⚡ CodSec SOAR Evaluator is running"
	@echo "  ──────────────────────────────────────"
	@echo "  Frontend:  http://localhost:3000"
	@echo "  Backend:   http://localhost:8000"
	@echo "  API Docs:  http://localhost:8000/docs"
	@echo ""

down: ## Stop all containers
	docker compose down

restart: ## Restart all containers
	docker compose restart

logs: ## Tail logs from all containers
	docker compose logs -f

logs-backend: ## Tail backend logs only
	docker compose logs -f backend

logs-frontend: ## Tail frontend logs only
	docker compose logs -f frontend

status: ## Show container status
	@echo ""
	@docker compose ps
	@echo ""
	@echo "── Health Checks ──"
	@curl -s http://localhost:8000/api/health | python3 -m json.tool 2>/dev/null || echo "Backend: unreachable"
	@echo ""

# ── Maintenance ──

clean: ## Stop containers and remove volumes/images
	docker compose down -v --rmi local
	docker system prune -f

shell-backend: ## Open shell in backend container
	docker compose exec backend /bin/bash

shell-frontend: ## Open shell in frontend container
	docker compose exec frontend /bin/sh

# ── Production ──

prod-build: ## Build for production
	docker compose -f docker-compose.yml build --no-cache
	@echo "✅ Production images built"

prod-up: ## Start production stack
	docker compose -f docker-compose.yml up -d
	@echo "✅ Production stack running"

# ── Testing ──

test-backend: ## Run backend tests
	cd backend && python -m pytest tests/ -v

test-api: ## Quick API smoke test
	@echo "Testing /api/health..."
	@curl -sf http://localhost:8000/api/health | python3 -m json.tool
	@echo "\nTesting /api/overview..."
	@curl -sf http://localhost:8000/api/overview | python3 -m json.tool
	@echo "\n✅ API responding"
