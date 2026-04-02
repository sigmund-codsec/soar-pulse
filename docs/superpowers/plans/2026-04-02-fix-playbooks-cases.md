# Fix Playbooks & Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix playbook loading (400 error) and case retrieval (low counts) in the Chronicle SOAR backend.

**Architecture:** All changes are in `backend/main.py`. Fix the playbook endpoint to use the correct API call, change case filters from millisecond timestamps to RFC 3339, and add pagination loops for complete data retrieval.

**Tech Stack:** Python, FastAPI, httpx, Chronicle SecOps v1alpha API

**Spec:** `docs/superpowers/specs/2026-04-02-fix-playbooks-cases-design.md`

---

### Task 1: Add a pagination helper function

**Files:**
- Modify: `backend/main.py:54-118` (add after `chronicle_request`)

This helper will be reused by both the cases and trends endpoints to follow `nextPageToken`.

- [ ] **Step 1: Write the paginated fetch helper**

Add this function after `chronicle_request()` (after line 118) in `backend/main.py`:

```python
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

    return all_items
```

- [ ] **Step 2: Verify the server still starts**

Run:
```bash
cd backend && python -c "from main import app; print('OK')"
```
Expected: `OK` (no import errors)

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add chronicle_paginated_fetch helper for multi-page API responses"
```

---

### Task 2: Fix the playbooks endpoint

**Files:**
- Modify: `backend/main.py:156-177` (`get_playbooks` function)

The current call to `legacyGetWorkflowMenuCardsWithEnvFilter` returns 400. We'll try two fixes in order:
1. First, try the same endpoint without the `format` param (the v1alpha wrapper may not accept it)
2. If that doesn't work, fall back to `GET {BASE}/playbooks` (the new-style resource endpoint)

We implement both as a primary/fallback pattern so the app is resilient.

- [ ] **Step 1: Update `get_playbooks` to try the new endpoint first with legacy fallback**

Replace the `get_playbooks` function (lines 156-177) in `backend/main.py` with:

```python
@app.get("/api/playbooks")
async def get_playbooks():
    """
    Fetch all playbooks from Chronicle SOAR.
    Tries the v1alpha playbooks resource first, falls back to the legacy endpoint.
    """
    playbooks_raw = []

    # Primary: new-style v1alpha playbooks list
    try:
        url = f"{SOAR_BASE}/playbooks"
        data = await chronicle_request("GET", url, params={"pageSize": 1000})
        playbooks_raw = data.get("playbooks", [])
        logger.info(f"Fetched {len(playbooks_raw)} playbooks via GET /playbooks")
    except HTTPException as e:
        logger.warning(f"GET /playbooks failed ({e.status_code}), trying legacy endpoint")

        # Fallback: legacy endpoint without format param
        url = f"{SOAR_BASE}/legacyPlaybooks:legacyGetWorkflowMenuCardsWithEnvFilter"
        data = await chronicle_request("POST", url, json_body={})
        playbooks_raw = data.get("workflowMenuCards", data.get("playbooks", []))
        logger.info(f"Fetched {len(playbooks_raw)} playbooks via legacy endpoint")

    playbooks = []
    for pb in playbooks_raw:
        name_field = pb.get("name", "")
        playbooks.append({
            "id": pb.get("id", name_field).split("/")[-1] if pb.get("id", name_field) else "",
            "name": pb.get("displayName", pb.get("name", "Unknown")),
            "status": _parse_playbook_status(pb),
            "description": pb.get("description", ""),
            "createTime": pb.get("createTime", pb.get("creationTime")),
            "updateTime": pb.get("updateTime", pb.get("modificationTime")),
            "category": pb.get("category", "Uncategorized"),
        })

    return {"playbooks": playbooks, "total": len(playbooks)}
```

- [ ] **Step 2: Add the `_parse_playbook_status` helper**

Add this above `get_playbooks` (before the `@app.get("/api/playbooks")` decorator):

```python
def _parse_playbook_status(pb: dict) -> str:
    """Normalize playbook status from various API response formats."""
    if pb.get("state") == "ENABLED" or pb.get("isEnabled") is True:
        return "Active"
    if pb.get("state") == "DISABLED" or pb.get("isEnabled") is False:
        return "Disabled"
    return "Disabled"
```

- [ ] **Step 3: Verify the server still starts**

Run:
```bash
cd backend && python -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "fix: playbooks endpoint — try v1alpha GET /playbooks first, fallback to legacy"
```

---

### Task 3: Fix case filter syntax (milliseconds -> RFC 3339)

**Files:**
- Modify: `backend/main.py:231-294` (`get_cases` function)

- [ ] **Step 1: Update `get_cases` to use RFC 3339 filter and pagination**

Replace the `get_cases` function (lines 231-294) in `backend/main.py` with:

```python
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
    url = f"{SOAR_BASE}/cases"
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
```

- [ ] **Step 2: Verify the server still starts**

Run:
```bash
cd backend && python -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "fix: case filter uses RFC 3339 timestamps and paginated fetch"
```

---

### Task 4: Fix case trends filter syntax and add pagination

**Files:**
- Modify: `backend/main.py:297-328` (`get_case_trends` function)

- [ ] **Step 1: Update `get_case_trends` to use RFC 3339 filter and pagination**

Replace the `get_case_trends` function (lines 297-328) in `backend/main.py` with:

```python
@app.get("/api/cases/trends")
async def get_case_trends(
    days: int = Query(default=180, ge=30, le=365),
):
    """
    Aggregate case volume by week/month for trend analysis.
    """
    url = f"{SOAR_BASE}/cases"
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
            if case.get("resolution") == "AUTO_RESOLVED" or case.get("closedByPlaybook"):
                monthly[month_key]["automated"] += 1
            else:
                monthly[month_key]["manual"] += 1

    trend = [
        {"month": k, **v}
        for k, v in sorted(monthly.items())
    ]
    return {"trends": trend, "period_days": days}
```

- [ ] **Step 2: Verify the server still starts**

Run:
```bash
cd backend && python -c "from main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "fix: case trends uses RFC 3339 timestamps and paginated fetch"
```

---

### Task 5: Manual integration test

**Files:**
- None (testing only)

Start the backend and verify each endpoint against the live Chronicle API.

- [ ] **Step 1: Start the backend**

Run:
```bash
cd backend && uvicorn main:app --reload --port 8000
```

- [ ] **Step 2: Test the health endpoint**

Run:
```bash
curl -s http://localhost:8000/api/health | python -m json.tool
```
Expected: `{"status": "ok", "auth_method": "bearer_token", ...}`

- [ ] **Step 3: Test the playbooks endpoint**

Run:
```bash
curl -s http://localhost:8000/api/playbooks | python -m json.tool
```
Expected: JSON with `{"playbooks": [...], "total": N}` where N > 0. If still 400, check server logs for which endpoint was tried and what error came back. If `GET /playbooks` also fails, the Swagger docs at `https://rb.siemplify-soar.com/swagger/index.html` should be checked for the correct endpoint.

- [ ] **Step 4: Test the cases endpoint**

Run:
```bash
curl -s "http://localhost:8000/api/cases?days=30" | python -m json.tool
```
Expected: JSON with `total_cases` reflecting the real count of cases in the last 30 days.

- [ ] **Step 5: Test the case trends endpoint**

Run:
```bash
curl -s "http://localhost:8000/api/cases/trends?days=180" | python -m json.tool
```
Expected: JSON with `trends` array containing monthly data.

- [ ] **Step 6: Test the overview endpoint (calls all others internally)**

Run:
```bash
curl -s http://localhost:8000/api/overview | python -m json.tool
```
Expected: JSON with `totalPlaybooks > 0` and `totalCases30d` reflecting accurate counts.

- [ ] **Step 7: Commit (if any adjustments were made during testing)**

```bash
git add backend/main.py
git commit -m "fix: adjustments from integration testing"
```
