#!/usr/bin/env python3
"""Censys search plugin for CyberStrikeAI."""
import os, sys, json, requests

API_ID = os.environ.get("CENSYS_API_ID", "")
API_SECRET = os.environ.get("CENSYS_API_SECRET", "")

if not API_ID or not API_SECRET:
    print(json.dumps({"status": "error", "message": "CENSYS_API_ID and CENSYS_API_SECRET must be set. Configure in Plugins settings."}))
    sys.exit(1)

query = sys.argv[1] if len(sys.argv) > 1 else ""
per_page = int(sys.argv[2]) if len(sys.argv) > 2 else 25
resource = sys.argv[3] if len(sys.argv) > 3 else "hosts"

if not query:
    print(json.dumps({"status": "error", "message": "Query is required"}))
    sys.exit(1)

url = f"https://search.censys.io/api/v2/{resource}/search"
try:
    resp = requests.get(url, params={"q": query, "per_page": per_page},
                       auth=(API_ID, API_SECRET), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    
    results = data.get("result", {}).get("hits", [])
    total = data.get("result", {}).get("total", 0)
    
    output = {"status": "ok", "query": query, "total": total, "count": len(results), "results": []}
    for hit in results:
        entry = {"ip": hit.get("ip", ""), "services": []}
        for svc in hit.get("services", []):
            entry["services"].append({
                "port": svc.get("port"),
                "service_name": svc.get("service_name", ""),
                "transport": svc.get("transport_protocol", ""),
            })
        if hit.get("autonomous_system", {}).get("name"):
            entry["asn"] = hit["autonomous_system"]["name"]
        if hit.get("location", {}).get("country"):
            entry["country"] = hit["location"]["country"]
        output["results"].append(entry)
    
    print(json.dumps(output, indent=2))
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 401:
        print(json.dumps({"status": "error", "message": "Invalid Censys API credentials (401)"}))
    else:
        print(json.dumps({"status": "error", "message": str(e)}))
    sys.exit(1)
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))
    sys.exit(1)
