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

import os
import logging
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("codsec")

# ── Runtime credentials (overrides .env when set via /api/connect) ────
_runtime: dict = {}

def _get_token() -> Optional[str]:
    return _runtime.get("token") or CHRONICLE_BEARER_TOKEN

def _get_app_key() -> Optional[str]:
    return _runtime.get("app_key") or os.getenv("CHRONICLE_APP_KEY")

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
) -> dict:
    """Make authenticated request to Chronicle API."""
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
            detail="No Chronicle credentials configured. Use the connect screen to provide your credentials.",
        )

    headers["Content-Type"] = "application/json"

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.request(
                method, url, headers=headers, params=merged_params, json=json_body
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            response_messsage = e.response.text

            logger.error(f"Chronicle API error: {status_code} — {response_messsage}")
            
            if status_code == 400:
                try:
                    body = e.response.json()
                    api_detail = body.get("details") or body.get("title") or e.response.text
                except Exception:
                    api_detail = e.response.text
                raise HTTPException(
                    status_code=400,
                    detail=f"Chronicle API bad request: {api_detail}",
                )
            if status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="Chronicle API rejected the token (401 Unauthorized). Check that CHRONICLE_BEARER_TOKEN in .env is valid and not expired.",
                )
            if status_code == 403:
                raise HTTPException(
                    status_code=403,
                    detail="Chronicle API denied access (403 Forbidden). The token may lack the required permissions.",
                )
            raise HTTPException(
                status_code=status_code,
                detail=f"Chronicle API error: {e.response.text}",
            )
        except httpx.RequestError as e:
            logger.error(f"Chronicle request failed: {e}")
            raise HTTPException(status_code=502, detail=f"Chronicle connection error: {str(e)}")


async def chronicle_paginated_fetch(
    url: str,
    params: dict,
    result_key: str,
    max_pages: int = 20,
) -> list:
    """Fetch all pages from a Chronicle API list endpoint."""
    all_items = []
    page_token = None

    for _ in range(max_pages):
        page_params = dict(params)
        if page_token:
            page_params["pageToken"] = page_token

        data = await chronicle_request("GET", url, params=page_params)
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

app = FastAPI(
    title="CodSec SOAR Evaluator API",
    description="Chronicle SOAR environment health assessment",
    version="1.0.0",
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
    app_key: str
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
    app_key = req.app_key.strip()

    # Validate by hitting the external metadata endpoint
    test_url = f"{host}/api/external/v1/playbooks/GetPlaybooksMetadata"
    headers = {"AppKey": app_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(test_url, headers=headers)
            if resp.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid App Key — Chronicle rejected the credentials.")
            if resp.status_code == 403:
                raise HTTPException(status_code=403, detail="App Key lacks required permissions (403 Forbidden).")
            if resp.status_code == 404:
                # Try alternate endpoint
                resp = await client.get(
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
    _runtime["app_key"] = app_key
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

def _parse_playbook_status(pb: dict) -> str:
    """Normalize playbook status from various API response formats."""
    if pb.get("isPublished") or pb.get("published"):
        return "Active"
    if pb.get("state") == "ENABLED" or pb.get("isEnabled") is True:
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

    async with httpx.AsyncClient(timeout=30.0) as client:
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
                # If d.results pattern
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


def _normalise_playbook(pb: dict) -> dict:
    """Normalise a raw playbook metadata dict to our API shape."""
    modified = pb.get("modificationTime") or pb.get("lastModified") or pb.get("modifiedTime") or ""
    identifier = (
        pb.get("identifier") or pb.get("id") or
        pb.get("workflowIdentifier") or pb.get("originalPlaybookIdentifier") or ""
    )
    return {
        "id": str(identifier),
        "name": pb.get("name") or pb.get("playbookName") or pb.get("title") or "Unnamed",
        "status": _parse_playbook_status(pb),
        "description": pb.get("description") or "",
        "createTime": pb.get("creationTime") or pb.get("createTime") or pb.get("createdTime"),
        "updateTime": modified or None,
        "category": pb.get("category") or pb.get("playbookType") or pb.get("workflowType") or "General",
    }


@app.get("/api/playbooks")
async def get_playbooks():
    """Fetch all playbooks from Chronicle SOAR via the external API."""
    playbooks_raw = await _fetch_playbooks_metadata()
    playbooks = [_normalise_playbook(pb) for pb in playbooks_raw]
    return {"playbooks": playbooks, "total": len(playbooks)}


@app.get("/api/playbooks/{playbook_id}/runs")
async def get_playbook_runs(
    playbook_id: str,
    days: int = Query(default=30, ge=1, le=365),
):
    """
    Fetch execution history for a specific playbook.
    """
    url = f"{_get_soar_base()}/playbooks/{playbook_id}/executions"
    start_time = (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"
    params = {"filter": f'create_time>"{start_time}"', "pageSize": 1000}

    data = await chronicle_request("GET", url, params=params)
    executions = data.get("executions", [])

    runtimes = []
    statuses = {"SUCCESS": 0, "FAILED": 0, "RUNNING": 0, "CANCELLED": 0}

    for ex in executions:
        status = ex.get("state", "UNKNOWN")
        statuses[status] = statuses.get(status, 0) + 1

        start = ex.get("startTime")
        end = ex.get("endTime")
        if start and end:
            try:
                s = datetime.fromisoformat(start.replace("Z", "+00:00"))
                e = datetime.fromisoformat(end.replace("Z", "+00:00"))
                runtimes.append((e - s).total_seconds())
            except (ValueError, TypeError):
                pass

    avg_runtime = sum(runtimes) / len(runtimes) if runtimes else 0
    p95_runtime = sorted(runtimes)[int(len(runtimes) * 0.95)] if len(runtimes) > 1 else avg_runtime
    total = len(executions)
    fail_rate = (statuses.get("FAILED", 0) / total * 100) if total > 0 else 0

    return {
        "playbook_id": playbook_id,
        "period_days": days,
        "total_runs": total,
        "avg_runtime_sec": round(avg_runtime, 2),
        "p95_runtime_sec": round(p95_runtime, 2),
        "fail_rate_pct": round(fail_rate, 2),
        "statuses": statuses,
        "runtimes": runtimes[-100:],  # last 100 for charting
    }


# ── Cases ─────────────────────────────────────────────────────────────

@app.get("/api/cases")
async def get_cases(
    days: int = Query(default=30, ge=1, le=365),
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    page_size: int = Query(default=100, ge=1, le=1000),
):
    """
    Fetch cases from Chronicle SOAR with optional filters.
    """
    url = f"{_get_soar_base()}/cases"
    start_iso = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    filter_parts = [f'createTime > "{start_iso}"']
    if status:
        filter_parts.append(f'status = "{status}"')
    if severity:
        filter_parts.append(f'severity = "{severity}"')
    filter_str = " AND ".join(filter_parts)

    params = {"pageSize": page_size, "filter": filter_str}
    cases = await chronicle_paginated_fetch(url, params, result_key="cases")

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

    return {
        "total_cases": len(cases),
        "period_days": days,
        "severity_breakdown": severity_counts,
        "status_breakdown": status_counts,
        "avg_mttr_hours": round(avg_mttr, 2),
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
    start_iso = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    params = {"pageSize": 1000, "filter": f'createTime > "{start_iso}"'}
    cases = await chronicle_paginated_fetch(url, params, result_key="cases")

    monthly = {}
    for case in cases:
        created = case.get("createTime", "")
        if created:
            month_key = str(created)[:7]  # YYYY-MM
            if month_key not in monthly:
                monthly[month_key] = {"total": 0, "automated": 0, "manual": 0}
            monthly[month_key]["total"] += 1
            # Chronicle marks auto-resolved cases
            if case.get("resolution") == "AUTO_RESOLVED" or case.get("closedByPlaybook"):
                monthly[month_key]["automated"] += 1
            else:
                monthly[month_key]["manual"] += 1

    trend = [
        {"month": k, **v}
        for k, v in sorted(monthly.items())
    ]
    return {"trends": trend, "period_days": days}


# ── Integrations ──────────────────────────────────────────────────────

@app.get("/api/integrations")
async def get_integrations():
    """
    Fetch configured integrations and their health status.
    Chronicle SOAR tracks connectors/integrations.
    """
    url = f"{_get_soar_base()}/integrations"
    data = await chronicle_request("GET", url, params={
        "format": "camel",
        "filter": "(internal != true) and (type = 'RESPONSE')",
        "pageSize": 1000,
    })
    connectors = data.get("integrations", data.get("connectors", data.get("data", [])))

    integrations = []
    for conn in connectors:
        last_heartbeat_raw = conn.get("lastHeartbeatTimeUnixTimeInMs", conn.get("lastHeartbeatTime"))
        status = "Healthy"
        if last_heartbeat_raw:
            try:
                if isinstance(last_heartbeat_raw, (int, float)):
                    hb = datetime.utcfromtimestamp(last_heartbeat_raw / 1000)
                else:
                    hb = datetime.fromisoformat(str(last_heartbeat_raw).replace("Z", "+00:00")).replace(tzinfo=None)
                age_min = (datetime.utcnow() - hb).total_seconds() / 60
                if age_min > 30:
                    status = "Error"
                elif age_min > 10:
                    status = "Degraded"
            except (ValueError, TypeError):
                status = "Unknown"

        integrations.append({
            "id": str(conn.get("id", conn.get("name", ""))),
            "name": conn.get("displayName", conn.get("name", "Unknown")),
            "status": status,
            "type": conn.get("connectorType", conn.get("integrationType", "")),
            "lastHeartbeat": last_heartbeat_raw,
            "version": conn.get("version", ""),
            "isEnabled": conn.get("isEnabled", conn.get("state") == "ENABLED"),
        })

    return {"integrations": integrations, "total": len(integrations)}


# ── Overview / Aggregated Stats ───────────────────────────────────────

@app.get("/api/overview")
async def get_overview():
    """
    Aggregated overview combining playbooks, cases, and integrations.
    Calls internal endpoints and merges results.
    """
    try:
        playbooks_data = await get_playbooks()
        cases_data = await get_cases(days=30)
        integrations_data = await get_integrations()
        trends_data = await get_case_trends(days=180)

        pbs = playbooks_data["playbooks"]
        active = sum(1 for p in pbs if p["status"] == "Active")
        disabled = sum(1 for p in pbs if p["status"] == "Disabled")

        total_cases = cases_data["total_cases"]
        open_cases = cases_data["status_breakdown"].get("OPEN", 0) + \
                     cases_data["status_breakdown"].get("IN_PROGRESS", 0)

        healthy_int = sum(1 for i in integrations_data["integrations"] if i["status"] == "Healthy")
        total_int = integrations_data["total"]

        # Calculate automation rate from trends
        trends = trends_data["trends"]
        total_trended = sum(t["total"] for t in trends)
        auto_trended = sum(t["automated"] for t in trends)
        automation_rate = (auto_trended / total_trended * 100) if total_trended > 0 else 0

        # Maturity score calculation
        playbook_coverage = min((active / max(active + disabled, 1)) * 100, 100)
        integration_health = (healthy_int / max(total_int, 1)) * 100
        maturity = int(
            automation_rate * 0.35 +
            playbook_coverage * 0.25 +
            integration_health * 0.25 +
            min(100, (100 - cases_data.get("avg_mttr_hours", 10))) * 0.15
        )

        return {
            "totalPlaybooks": len(pbs),
            "activePlaybooks": active,
            "disabledPlaybooks": disabled,
            "totalCases30d": total_cases,
            "openCases": open_cases,
            "avgMttrHours": cases_data["avg_mttr_hours"],
            "automationRate": round(automation_rate, 1),
            "maturityScore": max(0, min(100, maturity)),
            "integrationHealth": {
                "total": total_int,
                "healthy": healthy_int,
                "degraded": sum(1 for i in integrations_data["integrations"] if i["status"] == "Degraded"),
                "error": sum(1 for i in integrations_data["integrations"] if i["status"] == "Error"),
            },
            "severityBreakdown": cases_data["severity_breakdown"],
            "caseTrends": trends,
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

        # Check integrations
        int_health = overview.get("integrationHealth", {})
        if int_health.get("error", 0) > 0:
            findings.append({
                "type": "critical",
                "title": f"{int_health['error']} integration(s) in error state",
                "detail": "Failing integrations may cause silent playbook failures. Check credentials and connectivity.",
            })
        if int_health.get("degraded", 0) > 0:
            findings.append({
                "type": "warning",
                "title": f"{int_health['degraded']} integration(s) degraded",
                "detail": "Degraded integrations may cause increased latency. Monitor for further deterioration.",
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
