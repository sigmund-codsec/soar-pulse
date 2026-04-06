"""
CodSec Chronicle SOAR Evaluator — FastAPI Backend
===================================================
Connects to Google Chronicle SOAR (Security Operations) API
and exposes normalized endpoints for the React frontend.

Setup:
  1. Copy .env.example → .env and fill in your credentials
  2. pip install -r requirements.txt
  3. uvicorn main:app --reload --port 8000
"""

import asyncio
import os
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────
_raw_token = os.getenv("CHRONICLE_BEARER_TOKEN", "").strip()
CHRONICLE_BEARER_TOKEN = _raw_token.removeprefix("Bearer ").strip() or None
CHRONICLE_SOAR_HOST = os.getenv("CHRONICLE_SOAR_HOST", "rb.siemplify-soar.com")
CHRONICLE_INSTANCE = os.getenv("CHRONICLE_INSTANCE_ID")
CHRONICLE_REGION = os.getenv("CHRONICLE_REGION", "eu")
CHRONICLE_PROJECT_ID = os.getenv("CHRONICLE_PROJECT_ID")
CHRONICLE_SA_FILE = os.getenv("CHRONICLE_SA_FILE")
CHRONICLE_API_KEY = os.getenv("CHRONICLE_API_KEY")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("codsec")

# ── Shared HTTP client (connection pool, reused across all requests) ──
# Limits: 100 total connections, 20 per host — avoids overwhelming the SOAR API
# while still allowing high concurrency for parallel playbook detail fetches.
_http_client: Optional[httpx.AsyncClient] = None

def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=5.0),
            limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
            http2=False,  # SOAR API does not support HTTP/2
        )
    return _http_client

# ── Simple in-memory response cache (TTL: 60s) ────────────────────────
_cache: dict = {}  # key → (timestamp, value)
CACHE_TTL = 300  # seconds (5 min — covers full page load cycle)

def _cache_get(key: str):
    entry = _cache.get(key)
    if entry and (time.monotonic() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None

def _cache_set(key: str, value):
    _cache[key] = (time.monotonic(), value)

# ── Runtime credentials (overrides .env when set via /api/connect) ────
_runtime: dict = {}

def _get_token() -> Optional[str]:
    return _runtime.get("token") or CHRONICLE_BEARER_TOKEN

def _get_app_key() -> Optional[str]:
    """App Key for legacy Siemplify external API (AppKey header). Uses CHRONICLE_API_KEY."""
    return _runtime.get("app_key") or CHRONICLE_API_KEY

def _get_base_url() -> str:
    """Base URL for the SOAR host (e.g. https://rb.siemplify-soar.com)."""
    host = _runtime.get("host") or CHRONICLE_SOAR_HOST
    return f"https://{host}"

def _get_soar_base() -> str:
    if _runtime.get("soar_base"):
        return _runtime["soar_base"]
    return (
        f"https://{CHRONICLE_SOAR_HOST}/v1alpha/projects/{CHRONICLE_PROJECT_ID}"
        f"/locations/{CHRONICLE_REGION}/instances/{CHRONICLE_INSTANCE}"
    )

# ── Startup validation ────────────────────────────────────────────────
_has_sa = bool(os.getenv("CHRONICLE_SA_FILE") and os.path.exists(os.getenv("CHRONICLE_SA_FILE", "")))
if not CHRONICLE_BEARER_TOKEN and not _has_sa:
    logger.warning(
        "CHRONICLE_BEARER_TOKEN is not set in .env and no runtime credentials yet. "
        "Use the connect screen to provide credentials at runtime."
    )
else:
    logger.info("Chronicle auth: .env credentials loaded")


# ── HTTP Client ───────────────────────────────────────────────────────

async def chronicle_request(
    method: str,
    url: str,
    params: dict = None,
    json_body: dict = None,
    timeout: float = 30.0,
    use_cache: bool = False,
) -> dict:
    """Make authenticated request to Chronicle API using the shared persistent client."""
    headers = {}
    merged_params = dict(params or {})

    app_key = _get_app_key()
    token = _get_token()
    if app_key:
        headers["AppKey"] = app_key
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    elif CHRONICLE_SA_FILE and os.path.exists(CHRONICLE_SA_FILE):
        auth_headers = get_auth_headers()
        headers.update(auth_headers)
    else:
        raise HTTPException(
            status_code=401,
            detail="No Chronicle credentials configured. Check CHRONICLE_BEARER_TOKEN or CHRONICLE_API_KEY in .env.",
        )

    headers["Content-Type"] = "application/json"

    # Check cache for GET requests
    cache_key = None
    if use_cache:
        cache_key = f"{method}:{url}?{merged_params}:{json_body}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    client = _get_client()
    try:
        resp = await client.request(
            method, url, headers=headers, params=merged_params, json=json_body,
            timeout=timeout,
        )
        resp.raise_for_status()
        result = resp.json()
        if cache_key:
            _cache_set(cache_key, result)
        return result
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        logger.error(f"Chronicle API error: {status_code} — {e.response.text}")
        if status_code == 400:
            try:
                body = e.response.json()
                api_detail = body.get("details") or body.get("title") or e.response.text
            except Exception:
                api_detail = e.response.text
            raise HTTPException(status_code=400, detail=f"Chronicle API bad request: {api_detail}")
        if status_code == 401:
            raise HTTPException(status_code=401, detail="Chronicle API rejected the token (401 Unauthorized). Check CHRONICLE_BEARER_TOKEN in .env.")
        if status_code == 403:
            raise HTTPException(status_code=403, detail="Chronicle API denied access (403 Forbidden).")
        raise HTTPException(status_code=status_code, detail=f"Chronicle API error: {e.response.text}")
    except httpx.RequestError as e:
        logger.error(f"Chronicle request failed: {e}")
        raise HTTPException(status_code=502, detail=f"Chronicle connection error: {str(e)}")


async def chronicle_paginated_fetch(
    url: str,
    params: dict,
    result_key: str,
    max_pages: int = 20,
    use_cache: bool = False,
) -> list:
    """Fetch all pages from a Chronicle API list endpoint using the shared client."""
    all_items = []
    page_token = None

    for _ in range(max_pages):
        page_params = dict(params)
        if page_token:
            page_params["pageToken"] = page_token

        data = await chronicle_request("GET", url, params=page_params, use_cache=use_cache)
        items = data.get(result_key, data.get("data", []))
        all_items.extend(items)

        page_token = data.get("nextPageToken")
        if not page_token:
            break
    else:
        if page_token:
            logger.warning(f"Pagination limit ({max_pages} pages) reached for {url} — results may be incomplete")

    return all_items


# ── FastAPI App ───────────────────────────────────────────────────────

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up the shared HTTP client on startup
    _get_client()
    logger.info("Shared HTTP client initialised")
    yield
    # Graceful shutdown — close persistent connections
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        logger.info("Shared HTTP client closed")

app = FastAPI(
    title="CodSec SOAR Evaluator API",
    description="Chronicle SOAR environment health assessment",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health Check ──────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Verify backend is running and credentials are configured."""
    has_token = bool(_get_token())
    has_sa = bool(CHRONICLE_SA_FILE and os.path.exists(CHRONICLE_SA_FILE or ""))
    connected = bool(_runtime.get("token") or CHRONICLE_BEARER_TOKEN or has_sa)
    return {
        "status": "ok",
        "connected": connected,
        "auth_method": "runtime" if _runtime.get("token") else "bearer_token" if has_token else "service_account" if has_sa else "none",
        "host": _runtime.get("host") or CHRONICLE_SOAR_HOST,
        "instance": _runtime.get("instance") or CHRONICLE_INSTANCE,
        "region": _runtime.get("region") or CHRONICLE_REGION,
    }


# ── Connect / Disconnect ──────────────────────────────────────────────

class ConnectRequest(BaseModel):
    host: str
    app_key: Optional[str] = None
    bearer_token: Optional[str] = None
    # v1alpha fields — optional, only needed for cases/integrations endpoints
    project_id: Optional[str] = None
    region: Optional[str] = None
    instance_id: Optional[str] = None


@app.post("/api/connect")
async def connect(req: ConnectRequest):
    """
    Accept runtime credentials from the connect screen.
    Validates them against the external playbooks API, then stores in memory.
    """
    host = req.host.strip().rstrip("/")
    if not host.startswith("http"):
        host = f"https://{host}"
    app_key = (req.app_key or "").strip()
    bearer_token = (req.bearer_token or "").strip().removeprefix("Bearer ").strip()

    if not app_key and not bearer_token:
        raise HTTPException(status_code=400, detail="Provide either an App Key or a Bearer Token.")

    # Validate by hitting the external metadata endpoint
    test_url = f"{host}/api/external/v1/playbooks/GetPlaybooksMetadata"
    headers = {"Content-Type": "application/json"}
    if app_key:
        headers["AppKey"] = app_key
    else:
        headers["Authorization"] = f"Bearer {bearer_token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(test_url, headers=headers)
            if resp.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid App Key — Chronicle rejected the credentials.")
            if resp.status_code == 403:
                raise HTTPException(status_code=403, detail="App Key lacks required permissions (403 Forbidden).")
            if resp.status_code == 404:
                # Try alternate endpoint (POST)
                resp = await client.post(
                    f"{host}/api/external/v1/playbooks/GetEnabledWFCards",
                    headers={**headers,
                             "Content-Type": "application/json;odata.metadata=minimal;odata.streaming=true",
                             "accept": "application/json;odata.metadata=minimal;odata.streaming=true"},
                    content=b'{"caseEnvironment":"","executionScope":0}',
                )
                if resp.status_code not in (200, 400, 404):
                    raise HTTPException(status_code=resp.status_code, detail=f"Chronicle returned {resp.status_code}: {resp.text[:200]}")
            elif resp.status_code not in (200, 400):
                raise HTTPException(status_code=resp.status_code, detail=f"Chronicle returned {resp.status_code}: {resp.text[:200]}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Could not reach Chronicle: {str(e)}")

    # Strip https:// for storage — _get_base_url() re-adds it
    stored_host = host.removeprefix("https://").removeprefix("http://")

    # Store runtime credentials
    if app_key:
        _runtime["app_key"] = app_key
    if bearer_token:
        _runtime["token"] = bearer_token
    _runtime["host"] = stored_host
    if req.project_id:
        _runtime["project_id"] = req.project_id
    if req.region:
        _runtime["region"] = req.region
    if req.instance_id:
        _runtime["instance"] = req.instance_id
    if req.project_id and req.region and req.instance_id:
        _runtime["soar_base"] = (
            f"https://{stored_host}/v1alpha/projects/{req.project_id}"
            f"/locations/{req.region}/instances/{req.instance_id}"
        )

    logger.info(f"Runtime credentials set for host={stored_host}")
    return {"status": "connected", "host": stored_host}


@app.post("/api/disconnect")
async def disconnect():
    """Clear runtime credentials."""
    _runtime.clear()
    logger.info("Runtime credentials cleared")
    return {"status": "disconnected"}


# ── Playbooks ─────────────────────────────────────────────────────────

def _parse_playbook_status(pb: dict, full: dict = None) -> str:
    """Normalize playbook status from various API response formats."""
    full = full or {}
    if pb.get("isPublished") or pb.get("published"):
        return "Active"
    if pb.get("state") == "ENABLED" or pb.get("isEnabled") is True:
        return "Active"
    if full.get("isEnabled") is True:
        return "Active"
    if pb.get("isActive") is True:
        return "Active"
    return "Disabled"


async def _fetch_playbooks_metadata() -> list:
    """
    Fetch playbook metadata from the external Siemplify API.
    Tries multiple endpoint paths in order, matching SOARLens fallback chain.
    """
    base = _get_base_url()
    app_key = _get_app_key()
    token = _get_token()

    if not app_key and not token:
        raise HTTPException(status_code=401, detail="No credentials configured.")

    headers = {"Content-Type": "application/json"}
    if app_key:
        headers["AppKey"] = app_key
    else:
        headers["Authorization"] = f"Bearer {token}"

    get_paths = [
        "/api/external/v1/playbooks/GetPlaybooksMetadata",
        "/api/external/v1/playbooks/getPlaybooksMetadata",
        "/api/external/v1/playbooks/GetPlaybooks",
        "/api/external/v1/playbooks/GetPlaybooksMetaData",
        "/api/external/v1/playbooks",
        "/api/external/v1/workflows/GetPlaybooksMetadata",
        "/api/external/v1/workflows",
    ]

    client = _get_client()
    last_err = None

    for path in get_paths:
        url = f"{base}{path}"
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 404:
                continue
            if resp.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid credentials (401). Check your App Key.")
            if resp.status_code == 403:
                raise HTTPException(status_code=403, detail="Access denied (403). Check App Key permissions.")
            resp.raise_for_status()
            raw = resp.json()
            if isinstance(raw, list):
                logger.info(f"Fetched {len(raw)} playbooks via GET {path}")
                return raw
            for key in ("playbooks", "data", "value", "results"):
                if isinstance(raw.get(key), list):
                    logger.info(f"Fetched {len(raw[key])} playbooks via GET {path} (key={key})")
                    return raw[key]
            if raw.get("d") and isinstance(raw["d"].get("results"), list):
                return raw["d"]["results"]
            return raw if isinstance(raw, list) else []
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            last_err = e
            continue

    # Fallback: POST GetEnabledWFCards (Playbooks 2.0)
    try:
        wf_url = f"{base}/api/external/v1/playbooks/GetEnabledWFCards"
        resp = await client.post(
            wf_url,
            headers={**headers,
                     "Content-Type": "application/json;odata.metadata=minimal;odata.streaming=true",
                     "accept": "application/json;odata.metadata=minimal;odata.streaming=true"},
            content=b'{"caseEnvironment":"","executionScope":0}',
        )
        if resp.status_code not in (404,):
            resp.raise_for_status()
            raw = resp.json()
            if isinstance(raw, list):
                logger.info(f"Fetched {len(raw)} playbooks via POST GetEnabledWFCards")
                return raw
            if isinstance(raw.get("value"), list):
                return raw["value"]
    except Exception as e:
        last_err = e

    raise HTTPException(
        status_code=502,
        detail=f"Could not fetch playbook metadata — all endpoints failed. Last error: {last_err}",
    )


_SKIP_INTEGRATIONS = {"Flow", "SiemplifyUtilities", "SiemplifyTools", "AutomaticEnvironment", "Siemplify"}

def _extract_integrations(meta: dict, full: dict) -> list[str]:
    """Extract integration names from playbook detail (SOARLens pattern)."""
    found = set()

    def push(v):
        if not v:
            return
        if isinstance(v, list):
            for x in v:
                push(x)
        elif isinstance(v, str):
            clean = v.strip()
            if clean and clean not in _SKIP_INTEGRATIONS:
                found.add(clean)

    def scan(obj):
        if not obj or not isinstance(obj, dict):
            return
        push(obj.get("integration"))
        push(obj.get("integrationIdentifier"))
        push(obj.get("actionProvider"))
        if isinstance(obj.get("integrations"), list):
            push(obj["integrations"])
        for param in obj.get("parameters", []):
            if isinstance(param, dict) and param.get("name") == "IntegrationInstance":
                push(param.get("value"))
        for step in obj.get("steps", obj.get("workflowSteps", obj.get("actions", []))):
            scan(step)

    scan(full)
    if full.get("workflow"):
        scan(full["workflow"])

    # fallback to metadata if nothing found
    if not found:
        scan(meta)
        push(meta.get("integration"))
        push(meta.get("integrations"))

    return sorted(found)


def _count_steps(full: dict) -> int:
    for key in ("steps", "workflowSteps", "actions"):
        steps = full.get(key) or (full.get("workflow") or {}).get(key, [])
        if isinstance(steps, list) and steps:
            return len(steps)
    return 0


async def _fetch_playbook_detail(identifier: str, headers: dict) -> dict:
    """Fetch full playbook detail via GetWorkflowFullInfoByIdentifier using shared client."""
    if not identifier:
        return {}
    # Check cache first — playbook details rarely change within a session
    cache_key = f"pb_detail:{identifier}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    base = _get_base_url()
    client = _get_client()
    paths = [
        f"/api/external/v1/playbooks/GetWorkflowFullInfoByIdentifier/{identifier}",
        f"/api/external/v1/workflows/GetWorkflowFullInfoByIdentifier/{identifier}",
    ]
    for path in paths:
        try:
            resp = await client.get(f"{base}{path}", headers=headers)
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            result = resp.json()
            _cache_set(cache_key, result)
            return result
        except (httpx.HTTPStatusError, httpx.RequestError):
            continue
    return {}


def _get_pb_identifier(pb: dict) -> str:
    return (
        pb.get("workflowDefinitionIdentifier") or
        pb.get("identifier") or pb.get("id") or
        pb.get("workflowIdentifier") or pb.get("originalPlaybookIdentifier") or
        pb.get("originalWorkflowDefinitionIdentifier") or ""
    )


def _normalise_playbook(pb: dict, full: dict = None) -> dict:
    """Normalise a raw playbook metadata dict to our API shape."""
    full = full or {}
    modified = (
        full.get("modificationTimeUnixTimeInMs") or
        pb.get("modificationTime") or pb.get("lastModified") or pb.get("modifiedTime") or ""
    )
    if isinstance(modified, (int, float)) and modified > 0:
        from datetime import timezone
        modified = datetime.utcfromtimestamp(modified / 1000).strftime("%Y-%m-%d")
    identifier = _get_pb_identifier(pb)
    return {
        "id": str(identifier),
        "name": pb.get("name") or pb.get("playbookName") or pb.get("title") or "Unnamed",
        "status": _parse_playbook_status(pb, full),
        "description": pb.get("description") or full.get("description") or "",
        "createTime": pb.get("creationTime") or pb.get("createTime") or pb.get("createdTime"),
        "updateTime": modified or None,
        "category": pb.get("category") or pb.get("playbookType") or pb.get("workflowType") or "General",
        "integrations": _extract_integrations(pb, full),
        "steps": _count_steps(full),
        "environments": pb.get("environments") or [],
        "playbookType": "Block" if pb.get("playbookType") == 1 else "Playbook",
    }


@app.get("/api/playbooks")
async def get_playbooks():
    """
    Fetch all playbooks with full detail (integrations, steps) — SOARLens pattern.
    All detail requests run fully concurrently with a per-request timeout of 8s.
    Total endpoint timeout is handled by uvicorn (120s).
    """
    playbooks_raw = await _fetch_playbooks_metadata()

    app_key = _get_app_key()
    token = _get_token()
    headers = {"Content-Type": "application/json"}
    if app_key:
        headers["AppKey"] = app_key
    else:
        headers["Authorization"] = f"Bearer {token}"

    details = await asyncio.gather(*[
        _fetch_playbook_detail(_get_pb_identifier(pb), headers)
        for pb in playbooks_raw
    ], return_exceptions=True)

    playbooks = [
        _normalise_playbook(pb, full if isinstance(full, dict) else {})
        for pb, full in zip(playbooks_raw, details)
    ]
    return {"playbooks": playbooks, "total": len(playbooks)}


# ── Cases ─────────────────────────────────────────────────────────────

@app.get("/api/cases")
async def get_cases(
    days: int = Query(default=30, ge=1, le=365),
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    page_size: int = Query(default=100, ge=1, le=1000),
    skip_playbooks: bool = False,
):
    """
    Fetch cases from Chronicle SOAR with optional filters.
    """
    url = f"{_get_soar_base()}/cases"
    start_ms = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)

    filter_parts = [f"createTime > {start_ms}"]
    if status:
        filter_parts.append(f"status = '{status}'")
    if severity:
        filter_parts.append(f"severity = '{severity}'")
    filter_str = " and ".join(filter_parts)

    params = {
        "format": "camel",
        "filter": filter_str,
        "orderBy": "updateTime desc",
        "pageSize": page_size,
    }
    cases = await chronicle_paginated_fetch(url, params, result_key="cases", max_pages=20)

    severity_counts = {}
    status_counts = {}
    resolution_times = []

    for case in cases:
        sev = str(case.get("priority", case.get("severity", "UNKNOWN")))
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

        st = case.get("status", "UNKNOWN")
        status_counts[st] = status_counts.get(st, 0) + 1

        created = case.get("creationTime", case.get("createTime"))
        closed = case.get("closeTime", case.get("closedTime"))
        if created and closed:
            try:
                c = datetime.fromisoformat(str(created).replace("Z", "+00:00")) if isinstance(created, str) else datetime.utcfromtimestamp(created / 1000)
                cl = datetime.fromisoformat(str(closed).replace("Z", "+00:00")) if isinstance(closed, str) else datetime.utcfromtimestamp(closed / 1000)
                resolution_times.append((cl - c).total_seconds() / 3600)
            except (ValueError, TypeError):
                pass

    avg_mttr = sum(resolution_times) / len(resolution_times) if resolution_times else 0

    # Daily volume (computed from ALL cases, not just the truncated list)
    daily_counts: dict[str, int] = {}
    assignee_counts: dict[str, int] = {}
    for case in cases:
        created = case.get("creationTime", case.get("createTime"))
        if created:
            try:
                ts = created / 1000 if isinstance(created, (int, float)) else datetime.fromisoformat(str(created).replace("Z", "+00:00")).timestamp()
                day = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                daily_counts[day] = daily_counts.get(day, 0) + 1
            except (ValueError, TypeError, OSError):
                pass
        assignee = case.get("assignedUser", case.get("assignee", "Unassigned")) or "Unassigned"
        assignee_counts[assignee] = assignee_counts.get(assignee, 0) + 1

    daily_volume = [{"day": d, "count": c} for d, c in sorted(daily_counts.items())]
    top_assignees = sorted(assignee_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    # Fetch playbook names from case alerts (ALL cases, batched concurrently)
    top_playbooks = []
    if not skip_playbooks:
        all_ids = [
            str(c.get("id", c.get("name", "")))
            for c in cases
            if c.get("id") or c.get("name")
        ]

        async def _fetch_case_playbooks(case_id: str) -> list[str]:
            try:
                data = await chronicle_request(
                    "GET", f"{_get_soar_base()}/cases/{case_id}/alerts",
                    params={"format": "camel", "pageSize": 10},
                    timeout=5.0, use_cache=True,
                )
                return list({
                    a.get("attachedPlaybookName", "")
                    for a in data.get("alerts", [])
                    if a.get("attachedPlaybookName")
                })
            except Exception:
                return []

        # Process in batches of 100 concurrently
        playbook_counts: dict[str, int] = {}
        for batch_start in range(0, len(all_ids), 100):
            batch = all_ids[batch_start:batch_start + 100]
            pb_results = await asyncio.gather(*[_fetch_case_playbooks(cid) for cid in batch])
            for pbs in pb_results:
                for pb in pbs:
                    playbook_counts[pb] = playbook_counts.get(pb, 0) + 1
        top_playbooks = sorted(playbook_counts.items(), key=lambda x: x[1], reverse=True)

    return {
        "total_cases": len(cases),
        "period_days": days,
        "severity_breakdown": severity_counts,
        "status_breakdown": status_counts,
        "avg_mttr_hours": round(avg_mttr, 2),
        "daily_volume": daily_volume,
        "top_assignees": [{"name": n, "count": c} for n, c in top_assignees],
        "closed_with_time": len(resolution_times),
        "playbook_breakdown": [{"name": n, "count": c} for n, c in top_playbooks],
        "cases": [
            {
                "id": str(c.get("id", c.get("name", ""))),
                "title": c.get("title", c.get("displayName", "")),
                "severity": str(c.get("priority", c.get("severity", "UNKNOWN"))),
                "status": c.get("status", "UNKNOWN"),
                "assignee": c.get("assignedUser", c.get("assignee", "Unassigned")),
                "createTime": c.get("creationTime", c.get("createTime")),
                "closeTime": c.get("closeTime", c.get("closedTime")),
            }
            for c in cases[:200]
        ],
    }


@app.get("/api/cases/trends")
async def get_case_trends(
    days: int = Query(default=180, ge=30, le=365),
):
    """
    Aggregate case volume by week/month for trend analysis.
    """
    url = f"{_get_soar_base()}/cases"
    start_ms = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
    params = {"format": "camel", "pageSize": 1000, "filter": f"createTime > {start_ms}"}
    cases = await chronicle_paginated_fetch(url, params, result_key="cases", max_pages=5)

    monthly = {}
    for case in cases:
        created = case.get("createTime", "")
        if created:
            month_key = str(created)[:7]  # YYYY-MM
            if month_key not in monthly:
                monthly[month_key] = {"total": 0, "automated": 0, "manual": 0}
            monthly[month_key]["total"] += 1
            # Proxy: case has a closeTime → treated as resolved (automated/closed by playbook)
            # Chronicle's closedByPlaybook requires expand=closureDetails which is expensive.
            if case.get("closeTime") or case.get("closedTime"):
                monthly[month_key]["automated"] += 1
            else:
                monthly[month_key]["manual"] += 1

    trend = [
        {"month": k, **v}
        for k, v in sorted(monthly.items())
    ]
    return {"trends": trend, "period_days": days}


# ── Helpers ───────────────────────────────────────────────────────────

def _ext() -> str:
    """Base URL for the legacy Siemplify external API."""
    return f"{_get_base_url()}/api/external/v1"


async def _paginated_post(endpoint: str, base_payload: dict, use_cache: bool = False) -> list:
    """POST with Siemplify-style page iteration (requestedPage / totalNumberOfPages)."""
    cache_key = f"ppost:{endpoint}:{base_payload}" if use_cache else None
    if cache_key:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    results = []
    payload = {**base_payload, "requestedPage": 0, "pageSize": 500}
    while True:
        data = await chronicle_request("POST", f"{_ext()}/{endpoint}", json_body=payload)
        if not data:
            break
        items = data.get("objectsList", data if isinstance(data, list) else [])
        results.extend(items)
        total_pages = data.get("metadata", {}).get("totalNumberOfPages", 1) if isinstance(data, dict) else 1
        if payload["requestedPage"] >= total_pages - 1:
            break
        payload["requestedPage"] += 1

    if cache_key:
        _cache_set(cache_key, results)
    return results


# ── Connectors ────────────────────────────────────────────────────────

@app.get("/api/connectors")
async def get_connectors():
    """Fetch connector cards and their alert statistics concurrently."""
    data = await chronicle_request("GET", f"{_ext()}/connectors/cards", use_cache=True)
    raw = data if isinstance(data, list) else data.get("connectors", data.get("data", []))

    # Collect all cards with their identifiers
    all_cards = []
    for group in raw:
        integration = group.get("integration", "Unknown")
        for card in group.get("cards", []):
            identifier = card.get("identifier", "")
            all_cards.append({
                "integration": integration,
                "name": card.get("displayName", card.get("name", "")),
                "identifier": identifier,
                "isEnabled": card.get("isEnabled", False),
            })

    # Fetch statistics for each connector concurrently
    async def _fetch_stats(identifier: str) -> dict:
        if not identifier:
            return {}
        try:
            encoded = identifier.replace(" ", "%20")
            return await chronicle_request(
                "GET", f"{_ext()}/connectors/{encoded}/statistics?format=camel",
                use_cache=True, timeout=5.0
            )
        except Exception:
            return {}

    stats_list = await asyncio.gather(*[_fetch_stats(c["identifier"]) for c in all_cards])

    # Merge stats into cards and group by integration
    result = {}
    for card, stats in zip(all_cards, stats_list):
        card["alertsLastDay"] = stats.get("amountAlertsInLastDay", 0)
        card["avgAlertsPerDay"] = stats.get("avgAlertsPerDay", 0)
        integration = card.pop("integration")
        result.setdefault(integration, []).append(card)

    return {"connectors": result, "total": sum(len(v) for v in result.values())}


# ── Webhooks ──────────────────────────────────────────────────────────

@app.get("/api/webhooks")
async def get_webhooks():
    """Fetch webhook cards and their details — all detail calls run concurrently."""
    data = await chronicle_request("GET", f"{_ext()}/webhooks-management/cards", use_cache=True)
    raw = data if isinstance(data, list) else data.get("webhooks", data.get("data", []))

    async def _fetch_detail_and_stats(wh):
        identifier = wh.get("identifier", "")
        detail = {}
        stats = {}
        if identifier:
            try:
                detail, stats = await asyncio.gather(
                    chronicle_request(
                        "GET", f"{_ext()}/webhooks-management/{identifier}", use_cache=True
                    ),
                    chronicle_request(
                        "GET", f"{_ext()}/webhooks-management/{identifier}/statistics?format=camel",
                        use_cache=True, timeout=5.0
                    ),
                )
            except Exception:
                pass
        return {
            "identifier": identifier,
            "name": detail.get("name", wh.get("name", wh.get("displayName", ""))),
            "environment": detail.get("defaultEnvironment", ""),
            "isEnabled": detail.get("isEnabled", wh.get("isEnabled", False)),
            "alertsLastDay": stats.get("amountAlertsInLastDay", 0),
            "avgAlertsPerDay": stats.get("avgAlertsPerDay", 0),
        }

    webhooks = await asyncio.gather(*[_fetch_detail_and_stats(wh) for wh in raw])
    return {"webhooks": list(webhooks), "total": len(webhooks)}


# ── Environments ──────────────────────────────────────────────────────

@app.get("/api/environments")
async def get_environments():
    """Fetch all SOAR environments."""
    items = await _paginated_post("settings/GetEnvironments", {"searchTerm": ""}, use_cache=True)
    envs = [item.get("name", "") for item in items if item.get("name")]
    return {"environments": envs, "total": len(envs)}


# ── Remote Agents ─────────────────────────────────────────────────────

@app.get("/api/agents")
async def get_agents():
    """Fetch remote agents and their communication status."""
    STATUS_MAP = {0: "Live", 1: "Failed", 2: "Idle", 3: "Pending", 4: "Disabled"}
    data = await chronicle_request("GET", f"{_ext()}/agents/GetAgents", use_cache=True)
    agents_raw = data if isinstance(data, list) else data.get("agents", data.get("data", []))

    agent_ids = [a.get("identifier", "") for a in agents_raw if a.get("identifier")]
    statuses = {}
    if agent_ids:
        try:
            status_data = await chronicle_request(
                "POST", f"{_ext()}/agents/GetAgentsInformationByIdentifiers",
                json_body={"agentIdentifiers": agent_ids}
            )
            status_list = status_data if isinstance(status_data, list) else status_data.get("data", [])
            for s in status_list:
                statuses[s.get("agentIdentifier", "")] = STATUS_MAP.get(s.get("communicationStatus", -1), "Unknown")
        except Exception as e:
            logger.warning("Could not fetch agent statuses: %s", e)

    result = []
    for a in agents_raw:
        aid = a.get("identifier", "")
        result.append({
            "identifier": aid,
            "name": a.get("name", ""),
            "environments": a.get("environments", []),
            "status": statuses.get(aid, "Unknown"),
        })
    return {"agents": result, "total": len(result)}


# ── API Keys ──────────────────────────────────────────────────────────

@app.get("/api/api-keys")
async def get_api_keys():
    """Fetch configured API keys (names + environments only, no values)."""
    data = await chronicle_request("GET", f"{_ext()}/settings/GetApiKeys", use_cache=True)
    raw = data if isinstance(data, list) else data.get("apiKeys", data.get("data", []))
    keys = [{"name": k.get("name", ""), "environments": k.get("environments", [])} for k in raw]
    return {"apiKeys": keys, "total": len(keys)}


# ── Users ─────────────────────────────────────────────────────────────

@app.get("/api/users")
async def get_users():
    """Fetch user profiles."""
    items = await _paginated_post("settings/GetUserProfiles", {
        "searchTerm": "",
        "filterDisabledUsers": False,
        "filterRole": False,
        "filterPermissionTypes": [],
        "filterSupportUsers": True,
        "fetchOnlySupportUsers": False,
    }, use_cache=True)
    users = []
    for u in items:
        users.append({
            "id": u.get("id", ""),
            "email": u.get("email", ""),
            "socRoles": u.get("socRoles", []),
            "environments": u.get("environments", []),
            "providerName": u.get("providerName", ""),
            "isDisabled": u.get("isDisabled", False),
            "isDeleted": u.get("isDeleted", False),
        })
    return {"users": users, "total": len(users)}


# ── Integration Instances ─────────────────────────────────────────────

@app.get("/api/integration-instances")
async def get_integration_instances():
    """Fetch integration instances — shared + all environments concurrently."""

    async def _fetch_env(env_name: str):
        try:
            env_data = await chronicle_request(
                "POST", f"{_ext()}/integrations/GetEnvironmentInstalledIntegrations",
                json_body={"name": env_name},
            )
            return env_name, env_data.get("instances", [])
        except Exception:
            return env_name, []

    # Fetch environments list and shared instances concurrently
    try:
        envs_raw, shared_data = await asyncio.gather(
            _paginated_post("settings/GetEnvironments", {"searchTerm": ""}, use_cache=True),
            chronicle_request(
                "POST", f"{_ext()}/integrations/GetEnvironmentInstalledIntegrations",
                json_body={"name": "*"},
            ),
        )
    except Exception as e:
        logger.warning("Could not fetch integration instance base data: %s", e)
        return {"instances": [], "total": 0}

    env_names = [e.get("name", "") for e in envs_raw if e.get("name")]

    # Fetch all per-environment instances concurrently
    env_results = await asyncio.gather(*[_fetch_env(n) for n in env_names])

    instances = []
    for i in shared_data.get("instances", []):
        instances.append({
            "environment": "Shared",
            "type": i.get("integrationIdentifier", ""),
            "name": i.get("instanceName", ""),
            "isRemote": i.get("isRemote", False),
        })
    for env_name, env_instances in env_results:
        for i in env_instances:
            instances.append({
                "environment": env_name,
                "type": i.get("integrationIdentifier", ""),
                "name": i.get("instanceName", ""),
                "isRemote": i.get("isRemote", False),
            })

    return {"instances": instances, "total": len(instances)}


# ── Jobs ──────────────────────────────────────────────────────────────

@app.get("/api/jobs")
async def get_jobs():
    """Fetch installed SOAR jobs."""
    data = await chronicle_request("GET", f"{_ext()}/jobs/GetInstalledJobs", use_cache=True)
    raw = data if isinstance(data, list) else data.get("jobs", data.get("data", []))
    jobs = [
        {
            "name": j.get("name", ""),
            "integration": j.get("integration", ""),
            "isEnabled": j.get("isEnabled", False),
            "isCustom": j.get("isCustom", False),
        }
        for j in raw
    ]
    return {"jobs": jobs, "total": len(jobs)}


# ── Semver version comparison helpers ────────────────────────────────

def _parse_semver(v: str) -> tuple[int, int, int]:
    """Parse 'MAJOR.MINOR.PATCH' string into (int, int, int). Missing parts default to 0."""
    try:
        parts = str(v or "0").strip().lstrip("v").split(".")
        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2]) if len(parts) > 2 else 0
        return (major, minor, patch)
    except (ValueError, AttributeError):
        return (-1, -1, -1)  # sentinel for unparseable


def _version_risk(installed: str, latest: str) -> str:
    """
    Compare installed vs latest version strings.
    Returns: 'high' | 'medium' | 'low' | 'ok' | 'unknown'

    For semver (X.Y.Z): major gap = high, minor gap = medium, patch = low.
    For single-number versions (common in Siemplify): gap >= 10 = high,
    gap >= 3 = medium, gap >= 1 = low.
    """
    if not installed or not latest or installed == "unknown" or latest == "unknown":
        return "unknown"
    iv = _parse_semver(installed)
    lv = _parse_semver(latest)
    if iv == (-1, -1, -1) or lv == (-1, -1, -1):
        return "unknown"
    if iv == lv:
        return "ok"
    # Single-number versions (no dots) — use numeric gap
    if "." not in str(installed).strip() and "." not in str(latest).strip():
        gap = lv[0] - iv[0]
        if gap >= 10:
            return "high"
        if gap >= 3:
            return "medium"
        return "low"
    # Semver comparison
    if iv[0] < lv[0]:
        return "high"
    if iv[1] < lv[1]:
        return "medium"
    return "low"


# ── IDE / Integration Actions ─────────────────────────────────────────

@app.get("/api/ide")
async def get_ide():
    """Fetch installed integrations with version risk comparison.
    Two concurrent fetches:
      1. External API GetEnvironmentInstalledIntegrations — actions, isCustom
      2. v1alpha /integrations — version (installed), latestVersion (marketplace)
    Joined by identifier.
    """
    ext_data, v1_data = await asyncio.gather(
        chronicle_request(
            "POST", f"{_ext()}/integrations/GetEnvironmentInstalledIntegrations",
            json_body={"name": "*"}, use_cache=True
        ),
        chronicle_request(
            "GET", f"{_get_soar_base()}/integrations",
            use_cache=True, timeout=10.0
        ),
    )

    # Build version map from v1alpha: identifier -> {version, latestVersion}
    # v1alpha identifier may include "__<uuid>" suffix — strip it
    version_map: dict[str, dict] = {}
    for vi in v1_data.get("integrations", []):
        raw_id = vi.get("identifier") or vi.get("displayName", "")
        ident = raw_id.split("__")[0] if "__" in raw_id else raw_id
        ver = str(vi.get("version") or "")
        latest = str(vi.get("latestVersion") or "")
        # Some integrations appear multiple times (different envs); keep the one
        # with the highest installed version
        existing = version_map.get(ident)
        if not existing or (ver and ver > (existing.get("version") or "")):
            version_map[ident] = {"version": ver, "latestVersion": latest}

    ides = []
    for intg in ext_data.get("integrations", []):
        identifier = intg.get("identifier") or intg.get("name") or intg.get("displayName", "")
        actions = [f.get("name", "") for f in intg.get("integrationSupportedActions", [])]

        vm = version_map.get(str(identifier), {})
        installed_ver = vm.get("version") or str(intg.get("versionForDisplay") or intg.get("version") or "unknown")
        latest_ver = vm.get("latestVersion") or installed_ver
        # latestVersion of "0" means no marketplace entry (custom integration)
        if latest_ver in ("0", ""):
            latest_ver = installed_ver
        risk = _version_risk(installed_ver, latest_ver)

        ides.append({
            "name": intg.get("displayName", ""),
            "identifier": str(identifier),
            "isCustom": intg.get("isCustom", False),
            "installedVersion": installed_ver,
            "latestVersion": latest_ver,
            "versionRisk": risk,
            "actions": actions,
        })
    return {"integrations": ides, "total": len(ides)}


# ── Overview / Aggregated Stats ───────────────────────────────────────

@app.get("/api/overview")
async def get_overview():
    """
    Aggregated overview combining playbooks, cases, and integrations.
    Calls internal endpoints and merges results.
    """
    try:
        playbooks_data, cases_data, connectors_data, ide_data, webhooks_data = await asyncio.gather(
            get_playbooks(),
            get_cases(days=30, status=None, severity=None, page_size=1000, skip_playbooks=True),
            get_connectors(),
            get_ide(),
            get_webhooks(),
        )

        # ── Playbooks ──
        pbs = playbooks_data["playbooks"]
        active = sum(1 for p in pbs if p["status"] == "Active")
        disabled = sum(1 for p in pbs if p["status"] == "Disabled")
        unique_integrations = list({t for p in pbs for t in (p.get("integrations") or [])})

        # ── Cases ──
        total_cases = cases_data["total_cases"]
        status_bd = cases_data.get("status_breakdown", {})
        open_cases = status_bd.get("Opened", 0) + status_bd.get("IN_PROGRESS", 0)
        closed_statuses = {"CLOSED", "RESOLVED", "FALSE_POSITIVE", "MERGED", "Closed"}
        closed_count = sum(v for k, v in status_bd.items() if k in closed_statuses or k.upper() in closed_statuses)
        automation_rate = (closed_count / total_cases * 100) if total_cases > 0 else 0
        sev_bd = cases_data.get("severity_breakdown", {})
        crit_high = (sev_bd.get("PriorityCritical", 0) + sev_bd.get("PriorityHigh", 0))

        # Build daily trend from the returned case list
        daily: dict = {}
        for c in cases_data.get("cases", []):
            created = c.get("createTime")
            if created:
                try:
                    ts = created / 1000 if isinstance(created, (int, float)) else datetime.fromisoformat(str(created).replace("Z", "+00:00")).timestamp()
                    day_key = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                    if day_key not in daily:
                        daily[day_key] = {"total": 0, "closed": 0, "open": 0}
                    daily[day_key]["total"] += 1
                    if c.get("closeTime"):
                        daily[day_key]["closed"] += 1
                    else:
                        daily[day_key]["open"] += 1
                except (ValueError, TypeError, OSError):
                    pass
        trends = [{"day": k, **v} for k, v in sorted(daily.items())]

        # ── Connectors ──
        all_conns = [c for cards in connectors_data.get("connectors", {}).values() for c in cards]
        total_conns = len(all_conns)
        enabled_conns = sum(1 for c in all_conns if c.get("isEnabled"))
        active_conns = sum(1 for c in all_conns if (c.get("alertsLastDay") or 0) > 0)

        # ── Webhooks ──
        all_wh = webhooks_data.get("webhooks", [])
        total_wh = len(all_wh)
        enabled_wh = sum(1 for w in all_wh if w.get("isEnabled"))
        active_wh = sum(1 for w in all_wh if (w.get("alertsLastDay") or 0) > 0)

        # ── IDE / Integrations ──
        integrations = ide_data.get("integrations", [])
        total_int = len(integrations)
        outdated_high = sum(1 for i in integrations if i["versionRisk"] == "high")
        outdated_medium = sum(1 for i in integrations if i["versionRisk"] == "medium")
        outdated_low = sum(1 for i in integrations if i["versionRisk"] == "low")
        custom_int = sum(1 for i in integrations if i.get("isCustom"))

        # ── Maturity score ──
        playbook_coverage = min((active / max(active + disabled, 1)) * 100, 100)
        connector_health = (active_conns / max(enabled_conns, 1)) * 100  # % of enabled connectors receiving alerts
        integration_freshness = ((total_int - outdated_high - outdated_medium) / max(total_int, 1)) * 100
        maturity = int(
            automation_rate * 0.30 +
            playbook_coverage * 0.20 +
            integration_freshness * 0.20 +
            connector_health * 0.15 +
            min(100, (100 - cases_data.get("avg_mttr_hours", 10))) * 0.15
        )

        return {
            # Playbooks
            "totalPlaybooks": len(pbs),
            "activePlaybooks": active,
            "disabledPlaybooks": disabled,
            "uniqueIntegrations": len(unique_integrations),
            # Cases
            "totalCases30d": total_cases,
            "openCases": open_cases,
            "closedCases": closed_count,
            "critHighCases": crit_high,
            "avgMttrHours": cases_data["avg_mttr_hours"],
            "automationRate": round(automation_rate, 1),
            "severityBreakdown": sev_bd,
            "statusBreakdown": status_bd,
            "caseTrends": trends,
            # Connectors
            "totalConnectors": total_conns,
            "enabledConnectors": enabled_conns,
            "activeConnectors": active_conns,
            # Webhooks
            "totalWebhooks": total_wh,
            "enabledWebhooks": enabled_wh,
            "activeWebhooks": active_wh,
            # Integrations
            "totalIntegrations": total_int,
            "customIntegrations": custom_int,
            "outdatedHigh": outdated_high,
            "outdatedMedium": outdated_medium,
            "outdatedLow": outdated_low,
            # Score
            "maturityScore": max(0, min(100, maturity)),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Overview aggregation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Findings / Recommendations Engine ─────────────────────────────────

@app.get("/api/findings")
async def get_findings():
    """
    Automated assessment: analyze the environment and return findings.
    """
    findings = []

    try:
        overview = await get_overview()

        # Check automation rate
        auto_rate = overview.get("automationRate", 0)
        if auto_rate >= 70:
            findings.append({
                "type": "info",
                "title": f"Strong automation coverage at {auto_rate}%",
                "detail": "Above industry benchmark of ~60%. Indicates good playbook maturity.",
            })
        elif auto_rate >= 50:
            findings.append({
                "type": "warning",
                "title": f"Automation rate at {auto_rate}% — room for improvement",
                "detail": "Industry benchmark is ~60%. Review unhandled alert types for playbook candidates.",
            })
        else:
            findings.append({
                "type": "critical",
                "title": f"Low automation rate: {auto_rate}%",
                "detail": "Significant manual workload. Prioritize automating top-volume alert types.",
            })

        # Check disabled playbooks ratio
        disabled = overview.get("disabledPlaybooks", 0)
        total_pb = overview.get("totalPlaybooks", 1)
        if disabled / max(total_pb, 1) > 0.3:
            findings.append({
                "type": "warning",
                "title": f"{disabled} of {total_pb} playbooks disabled ({int(disabled/total_pb*100)}%)",
                "detail": "High ratio of disabled playbooks suggests technical debt. Review and archive unused ones.",
            })

        # Check connector health
        enabled_conns = overview.get("enabledConnectors", 0)
        active_conns = overview.get("activeConnectors", 0)
        if enabled_conns > 0 and active_conns == 0:
            findings.append({
                "type": "critical",
                "title": "No connectors are receiving alerts",
                "detail": f"{enabled_conns} connector(s) enabled but none received alerts in the last 24h. Check connector configuration and SIEM connectivity.",
            })
        elif enabled_conns > 0 and active_conns < enabled_conns * 0.5:
            findings.append({
                "type": "warning",
                "title": f"Only {active_conns} of {enabled_conns} enabled connectors are active",
                "detail": "Less than half of enabled connectors received alerts in the last 24h. Review inactive connectors.",
            })

        # Check MTTR
        mttr = overview.get("avgMttrHours", 0)
        if mttr > 8:
            findings.append({
                "type": "warning",
                "title": f"Mean time to resolve at {mttr}h",
                "detail": "Consider optimizing triage playbooks and auto-closure for low-severity cases.",
            })
        elif mttr > 0:
            findings.append({
                "type": "info",
                "title": f"Healthy MTTR at {mttr}h",
                "detail": "Resolution times are within acceptable range.",
            })

        # Check integration version risk
        high_count = overview.get("outdatedHigh", 0)
        medium_count = overview.get("outdatedMedium", 0)
        if high_count > 0:
            findings.append({
                "type": "critical",
                "title": f"{high_count} integration(s) are a major version behind",
                "detail": "Major version gaps may indicate missing features, security patches, or breaking API changes. Update via the Chronicle integration store.",
            })
        if medium_count > 0:
            findings.append({
                "type": "warning",
                "title": f"{medium_count} integration(s) are a minor version behind",
                "detail": "Minor version gaps may include bug fixes and enhancements. Review release notes and schedule updates.",
            })

        # Maturity
        score = overview.get("maturityScore", 0)
        findings.append({
            "type": "info" if score >= 70 else "warning",
            "title": f"Overall maturity score: {score}/100",
            "detail": "Based on automation coverage, playbook health, integration stability, and resolution times.",
        })

    except Exception as e:
        logger.error(f"Findings generation error: {e}")
        findings.append({
            "type": "critical",
            "title": "Unable to complete full assessment",
            "detail": f"Error during analysis: {str(e)}. Check API connectivity.",
        })

    return {"findings": findings}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
