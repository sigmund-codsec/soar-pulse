"""
CodSec — Chronicle SOAR Cases API Test Script
===============================================
Tests connectivity and pulls cases from your Google SecOps SOAR instance.

Setup:
  pip install httpx google-auth python-dotenv
  Fill in your .env file
  python test_cases.py
"""

import os
import sys
import json

import httpx
from dotenv import load_dotenv

load_dotenv()

# ── Config from .env ──────────────────────────────────────────────────

API_KEY = os.getenv("CHRONICLE_API_KEY")
BEARER_TOKEN = os.getenv("CHRONICLE_BEARER_TOKEN")
SA_FILE = os.getenv("CHRONICLE_SA_FILE")
PROJECT_ID = os.getenv("CHRONICLE_PROJECT_ID")
REGION = os.getenv("CHRONICLE_REGION", "eu")
INSTANCE_ID = os.getenv("CHRONICLE_INSTANCE_ID")
SOAR_HOST = os.getenv("CHRONICLE_SOAR_HOST", "rb.siemplify-soar.com")

# ── Build Base URL ────────────────────────────────────────────────────
# Pattern: https://{host}/v1alpha/projects/{project}/locations/{region}/instances/{instance}

BASE_URL = f"https://{SOAR_HOST}/v1alpha/projects/{PROJECT_ID}/locations/{REGION}/instances/{INSTANCE_ID}"

# ── Auth ──────────────────────────────────────────────────────────────

def get_headers() -> dict:
    """Build auth headers — tries bearer token first, then SA, then API key."""
    headers = {"Content-Type": "application/json"}

    # Option 1: Direct bearer token (from browser session, OAuth, etc.)
    if BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {BEARER_TOKEN}"
        print(f"  Auth: Bearer Token (***{BEARER_TOKEN[-8:]})")
        return headers

    # Option 2: Service account JSON key
    if SA_FILE and os.path.exists(SA_FILE):
        try:
            from google.auth.transport.requests import Request
            from google.oauth2 import service_account
            creds = service_account.Credentials.from_service_account_file(
                SA_FILE,
                scopes=["https://www.googleapis.com/auth/chronicle-backstory"]
            )
            creds.refresh(Request())
            headers["Authorization"] = f"Bearer {creds.token}"
            print(f"  Auth: Service Account ({SA_FILE})")
            return headers
        except Exception as e:
            print(f"  SA auth failed: {e}")

    # Option 3: API key
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
        print(f"  Auth: API Key (***{API_KEY[-6:]})")
        return headers

    print("  ERROR: No credentials found.")
    print("  Set one of these in .env:")
    print("    CHRONICLE_BEARER_TOKEN=eyJhbG...")
    print("    CHRONICLE_SA_FILE=./service-account.json")
    print("    CHRONICLE_API_KEY=your-key")
    sys.exit(1)


# ── API Endpoints to Try ──────────────────────────────────────────────

def build_endpoints() -> list:
    """Generate possible case endpoints under the instance-scoped URL."""
    return [
        {
            "name": "GET /cases",
            "method": "GET",
            "url": f"{BASE_URL}/cases",
            "params": {"pageSize": 5},
        },
        {
            "name": "POST /cases:search",
            "method": "POST",
            "url": f"{BASE_URL}/cases:search",
            "body": {"page_size": 5},
        },
        {
            "name": "GET /cases (filter: open)",
            "method": "GET",
            "url": f"{BASE_URL}/cases",
            "params": {"pageSize": 5, "filter": 'status="OPEN"'},
        },
        {
            "name": "POST /cases:batchGet",
            "method": "POST",
            "url": f"{BASE_URL}/cases:batchGet",
            "body": {},
        },
        {
            "name": "GET /casesList",
            "method": "GET",
            "url": f"{BASE_URL}/casesList",
            "params": {"pageSize": 5},
        },
    ]


# ── Test Runner ───────────────────────────────────────────────────────

def test_endpoint(client, headers, endpoint) -> dict:
    """Try a single endpoint and return the result."""
    try:
        if endpoint["method"] == "GET":
            resp = client.get(
                endpoint["url"],
                headers=headers,
                params=endpoint.get("params", {}),
                timeout=15.0,
            )
        else:
            resp = client.post(
                endpoint["url"],
                headers=headers,
                json=endpoint.get("body", {}),
                timeout=15.0,
            )

        return {
            "status": resp.status_code,
            "ok": resp.is_success,
            "body": resp.json() if resp.is_success else resp.text[:500],
        }
    except httpx.ConnectError:
        return {"status": 0, "ok": False, "body": "Connection refused / DNS failure"}
    except httpx.TimeoutException:
        return {"status": 0, "ok": False, "body": "Request timed out (15s)"}
    except Exception as e:
        return {"status": 0, "ok": False, "body": str(e)}


def print_cases(data):
    """Pretty-print case data if we got any."""
    # Try common response shapes
    cases = (
        data.get("cases")
        or data.get("results")
        or data.get("casesList")
        or (data if isinstance(data, list) else None)
        or []
    )

    if not cases:
        print("    (response OK but no cases found in response)")
        print(f"    Response keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")
        return

    print(f"    Found {len(cases)} case(s):\n")
    for i, case in enumerate(cases[:5]):
        # Try various field name patterns
        name = (
            case.get("displayName")
            or case.get("name")
            or case.get("title")
            or case.get("caseName")
            or "—"
        )
        severity = (
            case.get("severity")
            or case.get("priority")
            or case.get("casePriority")
            or "—"
        )
        status = (
            case.get("status")
            or case.get("state")
            or case.get("caseStatus")
            or "—"
        )
        created = (
            case.get("createTime")
            or case.get("createdTime")
            or case.get("creationTime")
            or case.get("openTime")
            or "—"
        )
        case_id = (
            case.get("id")
            or case.get("caseId")
            or (case.get("name", "").split("/")[-1] if case.get("name") else "—")
        )

        print(f"    [{i+1}] {name}")
        print(f"        ID:       {case_id}")
        print(f"        Severity: {severity}")
        print(f"        Status:   {status}")
        print(f"        Created:  {created}")
        print()


def main():
    print()
    print("=" * 64)
    print("  CodSec — Google SecOps SOAR Cases API Test")
    print("=" * 64)
    print()

    # Show config
    print("Configuration:")
    print(f"  Host:      {SOAR_HOST}")
    print(f"  Project:   {PROJECT_ID or 'NOT SET'}")
    print(f"  Region:    {REGION}")
    print(f"  Instance:  {INSTANCE_ID or 'NOT SET'}")
    print(f"  Base URL:  {BASE_URL}")
    print()

    # Validate required config
    missing = []
    if not PROJECT_ID:
        missing.append("CHRONICLE_PROJECT_ID")
    if not INSTANCE_ID:
        missing.append("CHRONICLE_INSTANCE_ID")
    if missing:
        print(f"ERROR: Missing required .env vars: {', '.join(missing)}")
        print()
        print("Your .env should look like:")
        print("  CHRONICLE_SOAR_HOST=rb.siemplify-soar.com")
        print("  CHRONICLE_PROJECT_ID=806183131932")
        print("  CHRONICLE_REGION=eu")
        print("  CHRONICLE_INSTANCE_ID=88c7bc29-b1c1-4dbf-b50a-365ed775f340")
        print("  CHRONICLE_API_KEY=your-api-key")
        sys.exit(1)

    headers = get_headers()
    endpoints = build_endpoints()

    print()
    print(f"Testing {len(endpoints)} endpoint patterns...")
    print("-" * 64)

    success = False
    all_results = []

    with httpx.Client() as client:
        for ep in endpoints:
            print()
            print(f"  [{ep['method']}] {ep['name']}")
            print(f"  URL: {ep['url']}")

            result = test_endpoint(client, headers, ep)
            all_results.append({"endpoint": ep, "result": result})

            if result["ok"]:
                print(f"  Status: {result['status']} OK")
                success = True
                print()
                print_cases(result["body"])

                # Dump raw response
                raw = json.dumps(result["body"], indent=2, default=str)
                print("    Raw response (first 2000 chars):")
                for line in raw[:2000].split("\n"):
                    print(f"    {line}")

                print()
                print("=" * 64)
                print(f"  WORKING ENDPOINT FOUND")
                print(f"  Method: {ep['method']}")
                print(f"  URL:    {ep['url']}")
                print("=" * 64)
                break
            else:
                status = result["status"] or "N/A"
                print(f"  Status: {status} FAILED")
                body_preview = str(result["body"])[:200]
                print(f"  Detail: {body_preview}")

    print()
    if success:
        print("  Next step: Share the output above and I'll update")
        print("  the backend main.py to match the working endpoint")
        print("  and response schema.")
    else:
        print("  All endpoints failed. Troubleshooting:")
        print()
        print("  1. Double-check your .env values match the URL you shared:")
        print(f"     https://{SOAR_HOST}/v1alpha/projects/{PROJECT_ID}/locations/{REGION}/instances/{INSTANCE_ID}/")
        print()
        print("  2. Try a raw curl to confirm connectivity:")
        print(f"     curl -v -H 'Authorization: Bearer YOUR_KEY' \\")
        print(f"       '{BASE_URL}/cases?pageSize=1'")
        print()
        print("  3. Check if the API key / SA has the right permissions")
        print("  4. Check if there's a VPN or firewall requirement")
        print()

        # Summary table
        print("  Results summary:")
        for r in all_results:
            status = r["result"]["status"] or "ERR"
            print(f"    {status:>4}  {r['endpoint']['name']}")

    print()


if __name__ == "__main__":
    main()