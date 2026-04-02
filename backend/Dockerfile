# ── CodSec SOAR Evaluator — Backend Dockerfile ──
# Multi-stage build for minimal production image

# Stage 1: Build dependencies
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Production image
FROM python:3.12-slim AS production

WORKDIR /app

# Security: run as non-root user
RUN groupadd -r codsec && useradd -r -g codsec -d /app -s /sbin/nologin codsec

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY main.py .

# Optional: copy service account file if present
# COPY service-account.json .

# Set ownership
RUN chown -R codsec:codsec /app

USER codsec

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/api/health').raise_for_status()" || exit 1

EXPOSE 8000

# Run with production-grade settings
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "4", \
     "--log-level", "info", \
     "--access-log", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
