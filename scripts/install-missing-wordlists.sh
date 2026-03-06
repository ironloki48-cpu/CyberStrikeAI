#!/usr/bin/env bash
set -euo pipefail

SUDO_PASS="${SUDO_PASS:-}"
if [[ -z "$SUDO_PASS" ]]; then
  echo "error: set SUDO_PASS env var" >&2
  exit 2
fi

run_sudo() {
  echo "$SUDO_PASS" | sudo -S "$@"
}

run_sudo mkdir -p /usr/share/wordlists/dirb /usr/share/wordlists/api

if [[ -f /usr/share/dirb/wordlists/common.txt ]]; then
  run_sudo ln -sf /usr/share/dirb/wordlists/common.txt /usr/share/wordlists/dirb/common.txt
fi

if [[ ! -s /usr/share/wordlists/api/api-endpoints.txt ]]; then
  tmp_api=$(mktemp)
  curl -fsSL "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/api/api-endpoints.txt" -o "$tmp_api"
  run_sudo install -m 0644 "$tmp_api" /usr/share/wordlists/api/api-endpoints.txt
  rm -f "$tmp_api"
fi

if [[ ! -s /usr/share/wordlists/rockyou.txt ]]; then
  tmp_rock=$(mktemp)
  curl -fL --retry 3 --retry-delay 2 "https://github.com/brannondorsey/naive-hashcat/releases/download/data/rockyou.txt" -o "$tmp_rock"
  run_sudo install -m 0644 "$tmp_rock" /usr/share/wordlists/rockyou.txt
  rm -f "$tmp_rock"
fi

echo "installed/verified:"
ls -lh /usr/share/wordlists/rockyou.txt /usr/share/wordlists/dirb/common.txt /usr/share/wordlists/api/api-endpoints.txt
