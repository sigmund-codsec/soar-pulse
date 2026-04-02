# Fix Playbooks Not Loading & Inaccurate Case Counts

**Date:** 2026-04-02
**Status:** Approved
**Approach:** Hybrid (Approach 3) — fix immediate issues now, plan googleapis.com migration later

---

## Problem Statement

Two bugs in the Chronicle SOAR backend (`backend/main.py`):

1. **Playbooks not loading** — the `/api/playbooks` endpoint returns a 400 error from Chronicle: `"Invalid arguments to the API"` / `"Incorrect input data."`
2. **Case counts too low** — the `/api/cases` endpoint returns fewer cases than expected.

The app connects to **Google Chronicle Security Operations (SecOps)** at `rb.siemplify-soar.com` using the v1alpha API surface.

---

## Root Causes

### Playbooks (400 Error)

The playbook endpoint at `main.py:162` calls:
```
POST {BASE}/legacyPlaybooks:legacyGetWorkflowMenuCardsWithEnvFilter
  params: {"format": "camel"}
  body: {}
```

The Chronicle API rejects this with "Invalid arguments." The legacy Siemplify equivalent was a GET request with different parameters. The v1alpha legacy wrapper likely expects different request parameters or body fields.

### Cases (Low Counts)

Two issues:

**A. Wrong filter syntax** (`main.py:243`):
```python
# Current (wrong) — millisecond timestamp
params = {"filter": f"createTime>={start_ms}"}

# Correct — RFC 3339 / ISO 8601
params = {"filter": f'createTime > "{start_iso}"'}
```
The Chronicle v1alpha API expects RFC 3339 timestamps, not milliseconds. A malformed filter may silently return partial results.

**B. No pagination** (`main.py:250`):
Only the first page of results is fetched. The Chronicle API uses `nextPageToken` for pagination. If there are more cases than `pageSize`, the rest are silently dropped. Same issue in the trends endpoint at `main.py:307`.

---

## Design

### Fix 1: Playbook Endpoint

1. Try fixing the current `legacyGetWorkflowMenuCardsWithEnvFilter` call:
   - Remove `params={"format": "camel"}` (may not be valid for v1alpha wrapper)
   - Try with empty body or with specific fields the endpoint may require
2. If the legacy wrapper cannot be made to work, fall back to `GET {BASE}/playbooks` — the new v1alpha resource-oriented endpoint that lists playbooks directly
3. Update response parsing at `main.py:166` to handle whichever response shape we get

### Fix 2: Case Filter Syntax

Change all time-based filters from millisecond timestamps to RFC 3339:

**`get_cases()` at line 243:**
```python
# Before
start_ms = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
params = {"pageSize": page_size, "filter": f"createTime>={start_ms}"}

# After
start_iso = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
params = {"pageSize": page_size, "filter": f'createTime > "{start_iso}"'}
```

**`get_case_trends()` at line 306:**
Same change — replace millisecond timestamp with RFC 3339.

### Fix 3: Pagination for Cases

Add a pagination loop that follows `nextPageToken`:

```python
all_cases = []
page_token = None
max_pages = 20  # safety limit

for _ in range(max_pages):
    params = {"pageSize": page_size, "filter": ...}
    if page_token:
        params["pageToken"] = page_token
    data = await chronicle_request("GET", url, params=params)
    all_cases.extend(data.get("cases", []))
    page_token = data.get("nextPageToken")
    if not page_token:
        break
```

Apply to both `get_cases()` and `get_case_trends()`.

---

## Scope

### In Scope
- Fix playbook endpoint request format
- Fix case filter syntax (milliseconds -> RFC 3339)
- Add pagination loop for cases and case trends
- Verify fixes work

### Out of Scope (deferred to migration)
- Migrating base URL to `chronicle.googleapis.com`
- Switching auth to OAuth2/service account
- Fixing integrations endpoint
- Frontend changes
- Retry logic, caching, resilience improvements

---

## Risk

The playbook fix may require trial and error without direct Swagger docs access. Fallback: use `GET {BASE}/playbooks` if the legacy wrapper remains broken.

---

## Files Modified

- `backend/main.py` — all changes contained here
