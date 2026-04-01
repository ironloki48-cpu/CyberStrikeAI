#!/usr/bin/env python3
"""
Censys Search Plugin for CyberStrikeAI
=======================================
Searches Censys internet-wide scan database for hosts, services, and certificates.
Supports: host search, certificate search, host detail lookup, account balance check.

API credentials are injected as environment variables by the plugin system.
API docs: https://search.censys.io/api
"""

import os
import sys
import json
import requests

# ── Config ──────────────────────────────────────────────────────────
API_BASE = "https://search.censys.io/api/v2"
API_ID = os.environ.get("CENSYS_API_ID", "").strip()
API_SECRET = os.environ.get("CENSYS_API_SECRET", "").strip()
TIMEOUT = 30


def api_auth():
    """Return requests auth tuple."""
    return (API_ID, API_SECRET)


def mask(s, keep=4):
    """Mask a secret for display."""
    if len(s) <= keep * 2:
        return "*" * len(s)
    return s[:keep] + "*" * (len(s) - keep * 2) + s[-keep:]


def validate_credentials():
    """Validate API credentials by calling /v1/account endpoint.
    Returns account info including quota/credits."""
    resp = requests.get("https://search.censys.io/api/v1/account",
                        auth=api_auth(), timeout=TIMEOUT)
    if resp.status_code == 401:
        return {"status": "error", "message": "Invalid Censys API credentials (401 Unauthorized)",
                "api_id_preview": mask(API_ID)}
    resp.raise_for_status()
    data = resp.json()
    quota = data.get("quota", {})
    return {
        "status": "ok",
        "message": "Censys API credentials valid",
        "api_id_preview": mask(API_ID),
        "login": data.get("login", ""),
        "email": data.get("email", ""),
        "quota": {
            "used": quota.get("used", 0),
            "allowance": quota.get("allowance", 0),
            "resets_at": quota.get("resets_at", ""),
        },
    }


def search_hosts(query, per_page=25, cursor=None, virtual_hosts="EXCLUDE"):
    """Search Censys hosts database.

    Args:
        query: CQL query string
        per_page: results per page (1-100)
        cursor: pagination cursor from previous response
        virtual_hosts: EXCLUDE, INCLUDE, or ONLY
    """
    params = {"q": query, "per_page": min(int(per_page), 100)}
    if cursor:
        params["cursor"] = cursor
    if virtual_hosts != "EXCLUDE":
        params["virtual_hosts"] = virtual_hosts

    resp = requests.get(f"{API_BASE}/hosts/search",
                        params=params, auth=api_auth(), timeout=TIMEOUT)
    if resp.status_code == 401:
        return {"status": "error", "message": "Invalid Censys API credentials"}
    if resp.status_code == 422:
        return {"status": "error", "message": f"Invalid query syntax: {resp.json().get('error', resp.text)}"}
    resp.raise_for_status()

    data = resp.json()
    result = data.get("result", {})
    hits = result.get("hits", [])
    total = result.get("total", 0)

    formatted = []
    for hit in hits:
        entry = {
            "ip": hit.get("ip", ""),
            "services": [],
            "autonomous_system": {},
            "location": {},
            "last_updated": hit.get("last_updated_at", ""),
        }
        # Services
        for svc in hit.get("services", []):
            svc_entry = {
                "port": svc.get("port"),
                "service_name": svc.get("service_name", "UNKNOWN"),
                "transport": svc.get("transport_protocol", ""),
            }
            if svc.get("software"):
                svc_entry["software"] = [s.get("product", "") + " " + s.get("version", "")
                                          for s in svc["software"] if s.get("product")]
            if svc.get("tls", {}).get("certificates", {}).get("leaf_data", {}).get("subject", {}).get("common_name"):
                svc_entry["tls_cn"] = svc["tls"]["certificates"]["leaf_data"]["subject"]["common_name"]
            if svc.get("http", {}).get("response", {}).get("html_title"):
                svc_entry["http_title"] = svc["http"]["response"]["html_title"]
            if svc.get("http", {}).get("response", {}).get("status_code"):
                svc_entry["http_status"] = svc["http"]["response"]["status_code"]
            if svc.get("banner"):
                svc_entry["banner_preview"] = svc["banner"][:200]
            entry["services"].append(svc_entry)
        # ASN
        asn = hit.get("autonomous_system", {})
        if asn:
            entry["autonomous_system"] = {
                "asn": asn.get("asn"),
                "name": asn.get("name", ""),
                "bgp_prefix": asn.get("bgp_prefix", ""),
                "country_code": asn.get("country_code", ""),
            }
        # Location
        loc = hit.get("location", {})
        if loc:
            entry["location"] = {
                "country": loc.get("country", ""),
                "city": loc.get("city", ""),
                "province": loc.get("province", ""),
                "coordinates": loc.get("coordinates", {}),
            }
        # Operating system
        if hit.get("operating_system", {}).get("product"):
            entry["os"] = hit["operating_system"]["product"] + " " + hit["operating_system"].get("version", "")
        # DNS
        if hit.get("dns", {}).get("reverse_dns", {}).get("names"):
            entry["reverse_dns"] = hit["dns"]["reverse_dns"]["names"]

        formatted.append(entry)

    output = {
        "status": "success",
        "query": query,
        "total": total,
        "count": len(formatted),
        "results": formatted,
    }
    # Pagination
    links = result.get("links", {})
    if links.get("next"):
        output["next_cursor"] = links["next"]
    if links.get("prev"):
        output["prev_cursor"] = links["prev"]

    return output


def search_certificates(query, per_page=25, cursor=None):
    """Search Censys certificate database."""
    params = {"q": query, "per_page": min(int(per_page), 100)}
    if cursor:
        params["cursor"] = cursor

    resp = requests.get(f"{API_BASE}/certificates/search",
                        params=params, auth=api_auth(), timeout=TIMEOUT)
    if resp.status_code == 401:
        return {"status": "error", "message": "Invalid Censys API credentials"}
    resp.raise_for_status()

    data = resp.json()
    result = data.get("result", {})
    hits = result.get("hits", [])
    total = result.get("total", 0)

    formatted = []
    for hit in hits:
        entry = {
            "fingerprint_sha256": hit.get("fingerprint_sha256", ""),
            "names": hit.get("names", []),
            "issuer": hit.get("parsed", {}).get("issuer_dn", ""),
            "subject": hit.get("parsed", {}).get("subject_dn", ""),
            "validity": {
                "start": hit.get("parsed", {}).get("validity_period", {}).get("not_before", ""),
                "end": hit.get("parsed", {}).get("validity_period", {}).get("not_after", ""),
            },
        }
        formatted.append(entry)

    output = {
        "status": "success",
        "query": query,
        "total": total,
        "count": len(formatted),
        "results": formatted,
    }
    links = result.get("links", {})
    if links.get("next"):
        output["next_cursor"] = links["next"]
    return output


def host_detail(ip):
    """Get detailed information for a specific IP address."""
    resp = requests.get(f"{API_BASE}/hosts/{ip}",
                        auth=api_auth(), timeout=TIMEOUT)
    if resp.status_code == 401:
        return {"status": "error", "message": "Invalid Censys API credentials"}
    if resp.status_code == 404:
        return {"status": "error", "message": f"Host {ip} not found in Censys database"}
    resp.raise_for_status()

    data = resp.json()
    result = data.get("result", {})
    return {
        "status": "success",
        "ip": ip,
        "services": result.get("services", []),
        "autonomous_system": result.get("autonomous_system", {}),
        "location": result.get("location", {}),
        "operating_system": result.get("operating_system", {}),
        "dns": result.get("dns", {}),
        "last_updated_at": result.get("last_updated_at", ""),
        "labels": result.get("labels", []),
    }


# ── Argument Parsing ────────────────────────────────────────────────

def parse_args():
    """Parse arguments from positional args or JSON."""
    if len(sys.argv) > 1:
        try:
            config = json.loads(sys.argv[1])
            if isinstance(config, dict):
                return config
        except (json.JSONDecodeError, TypeError):
            pass

    config = {}
    if len(sys.argv) > 1:
        config["query"] = sys.argv[1]
    if len(sys.argv) > 2:
        try:
            config["per_page"] = int(sys.argv[2])
        except ValueError:
            config["resource"] = sys.argv[2]
    if len(sys.argv) > 3:
        config["resource"] = sys.argv[3]
    if len(sys.argv) > 4:
        config["cursor"] = sys.argv[4]
    return config


# ── Main ────────────────────────────────────────────────────────────

def main():
    if not API_ID or not API_SECRET:
        print(json.dumps({
            "status": "error",
            "message": "CENSYS_API_ID and CENSYS_API_SECRET are not configured",
            "required_config": ["CENSYS_API_ID", "CENSYS_API_SECRET"],
            "note": "Go to Settings → Plugins → Censys → configure API keys. Get keys at https://search.censys.io/account/api"
        }, indent=2))
        sys.exit(1)

    config = parse_args()
    query = config.get("query", "").strip()
    resource = config.get("resource", "hosts").strip().lower()
    per_page = config.get("per_page", 25)
    cursor = config.get("cursor", None)

    # Special commands
    if query in ("validate", "balance", "account", "status"):
        result = validate_credentials()
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["status"] == "ok" else 1)

    if not query:
        print(json.dumps({
            "status": "error",
            "message": "Missing required parameter: query",
            "required_params": ["query"],
            "special_commands": ["validate — check API key validity and quota balance"],
            "query_examples": {
                "hosts": [
                    'services.port: 22',
                    'services.http.response.html_title: "Dashboard"',
                    'ip: 1.2.3.0/24',
                    'services.tls.certificates.leaf_data.subject.common_name: "*.example.com"',
                    'autonomous_system.name: "HETZNER"',
                    'services.service_name: SSH AND services.software.product: OpenSSH AND services.software.version: 7.*',
                    'labels: "c2"',
                    'services.http.response.headers.server: "Apache/2.4*"',
                    'operating_system.product: "Windows Server"',
                ],
                "certificates": [
                    'parsed.names: "*.example.com"',
                    'parsed.issuer.organization: "Let\'s Encrypt"',
                    'parsed.subject.common_name: "example.com"',
                ],
                "detail": [
                    '1.2.3.4  (returns full host detail for an IP)',
                ],
            }
        }, indent=2))
        sys.exit(1)

    # Route to the appropriate search function
    try:
        if resource == "certificates" or resource == "certs":
            result = search_certificates(query, per_page, cursor)
        elif resource == "detail" or resource == "host":
            result = host_detail(query)
        else:
            result = search_hosts(query, per_page, cursor)

        print(json.dumps(result, indent=2, default=str))
        sys.exit(0 if result.get("status") == "success" else 1)

    except requests.exceptions.HTTPError as e:
        error_body = ""
        try:
            error_body = e.response.json().get("error", e.response.text[:200])
        except Exception:
            error_body = str(e)
        print(json.dumps({
            "status": "error",
            "message": f"Censys API error (HTTP {e.response.status_code}): {error_body}",
            "suggestion": "Check query syntax at https://search.censys.io/search/explanations"
        }, indent=2))
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print(json.dumps({
            "status": "error",
            "message": "Cannot connect to Censys API (search.censys.io). Check network/DNS."
        }, indent=2))
        sys.exit(1)
    except requests.exceptions.Timeout:
        print(json.dumps({
            "status": "error",
            "message": "Censys API request timed out (30s). Try a more specific query."
        }, indent=2))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": f"Unexpected error: {type(e).__name__}: {str(e)}"
        }, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
