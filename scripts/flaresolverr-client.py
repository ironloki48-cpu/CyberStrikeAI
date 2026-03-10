#!/usr/bin/env python3
"""
Minimal FlareSolverr API client for CyberStrikeAI tool integration.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request


def parse_json_arg(raw: str, name: str):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON for {name}: {exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="FlareSolverr API client")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8191/v1", help="FlareSolverr API endpoint")
    parser.add_argument(
        "--cmd",
        default="request.get",
        choices=["request.get", "request.post", "sessions.create", "sessions.destroy"],
        help="FlareSolverr command",
    )
    parser.add_argument("--url", help="Target URL (required for request.get/request.post)")
    parser.add_argument("--session-id", help="Session ID for sticky browser sessions")
    parser.add_argument("--max-timeout", type=int, default=60000, help="Timeout in milliseconds")
    parser.add_argument("--post-data", help="POST body string for request.post")
    parser.add_argument("--proxy-url", help="Proxy URL for FlareSolverr request")
    parser.add_argument("--user-agent", help="Custom User-Agent for request")
    parser.add_argument("--headers-json", help='JSON object for headers, e.g. {"X-Test":"1"}')
    parser.add_argument("--cookies-json", help='JSON array for cookies, e.g. [{"name":"a","value":"b"}]')
    parser.add_argument("--download", action="store_true", help="Enable FlareSolverr download mode")
    parser.add_argument(
        "--cookies-only",
        action="store_true",
        help="Output only cookies from the response (as a header-ready string and JSON array)",
    )
    args = parser.parse_args()

    if args.cmd in ("request.get", "request.post") and not args.url:
        print("error: --url is required for request.get/request.post", file=sys.stderr)
        return 2
    if args.cmd == "sessions.destroy" and not args.session_id:
        print("error: --session-id is required for sessions.destroy", file=sys.stderr)
        return 2

    try:
        headers_json = parse_json_arg(args.headers_json, "headers-json")
        cookies_json = parse_json_arg(args.cookies_json, "cookies-json")
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    payload = {
        "cmd": args.cmd,
        "maxTimeout": args.max_timeout,
    }
    if args.url:
        payload["url"] = args.url
    if args.session_id:
        payload["session"] = args.session_id
    if args.post_data is not None:
        payload["postData"] = args.post_data
    if args.proxy_url:
        payload["proxy"] = {"url": args.proxy_url}
    if args.user_agent:
        payload["userAgent"] = args.user_agent
    if headers_json is not None:
        payload["headers"] = headers_json
    if cookies_json is not None:
        payload["cookies"] = cookies_json
    if args.download:
        payload["download"] = True

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        args.endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=max(30, args.max_timeout / 1000 + 5)) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                print(raw)
                return 0

            if args.cookies_only:
                cookies = (parsed.get("solution") or {}).get("cookies") or []
                user_agent = (parsed.get("solution") or {}).get("userAgent") or ""
                # Cookie header string for curl/httpx/ffuf etc.
                cookie_header = "; ".join(
                    f"{c['name']}={c['value']}" for c in cookies if "name" in c and "value" in c
                )
                out = {
                    "cookie_header": cookie_header,
                    "user_agent": user_agent,
                    "cookies": cookies,
                }
                print(json.dumps(out, ensure_ascii=False, indent=2))
            else:
                print(json.dumps(parsed, ensure_ascii=False, indent=2))
            return 0
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        print(f"error: HTTP {exc.code} from FlareSolverr: {err_body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"error: unable to reach FlareSolverr endpoint {args.endpoint}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
