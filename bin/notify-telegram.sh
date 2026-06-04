#!/usr/bin/env bash
# Telegram 通知 helper
# Usage:
#   bin/notify-telegram.sh "Message text"
#   bin/notify-telegram.sh -t "Custom title" "Message body"
#   echo "long stdout" | bin/notify-telegram.sh -t "Title" -
#
# Credentials は環境変数 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID で渡す。
# 順次以下を source 試行:
#   1. 既存 shell env
#   2. .env (repo root)
#   3. ~/.rollback/uniple-telegram-credentials.md
#
# 詳細: docs/handoff/08-telegram-notifications.md

set -euo pipefail

# --- credentials loader -----------------------------------------------------
load_creds() {
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    return 0
  fi
  local f
  for f in \
    "$(cd "$(dirname "$0")/.." && pwd)/.env" \
    "/home/ubuntu/uniple-checkout-shopify/.env" \
    "/home/ubuntu/.rollback/uniple-telegram-credentials.md"; do
    if [[ -f "$f" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$f" 2>/dev/null || true
      set +a
    fi
  done
}

load_creds

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  cat >&2 <<'ERR'
ERROR: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set.

Set via either:
- env vars in current shell, or
- .env in repo root, or
- /home/ubuntu/.rollback/uniple-telegram-credentials.md

See docs/handoff/08-telegram-notifications.md for setup.
ERR
  exit 1
fi

# --- parse args -------------------------------------------------------------
TITLE=""
while [[ $# -gt 0 && "${1:-}" == "-t" ]]; do
  TITLE="${2:-}"
  shift 2
done

if [[ $# -lt 1 ]]; then
  echo "ERROR: missing message arg or '-' for stdin" >&2
  exit 1
fi

if [[ "$1" == "-" ]]; then
  MESSAGE=$(cat)
else
  MESSAGE="$1"
fi

if [[ -z "${MESSAGE// /}" ]]; then
  echo "ERROR: empty message" >&2
  exit 1
fi

# --- compose ----------------------------------------------------------------
if [[ -n "$TITLE" ]]; then
  FULL=$(printf '*%s*\n%s' "$TITLE" "$MESSAGE")
else
  FULL="$MESSAGE"
fi

# Telegram message size limit: 4096 chars. Truncate if longer.
if [[ ${#FULL} -gt 4000 ]]; then
  FULL="${FULL:0:3900}

... (truncated)"
fi

# --- send -------------------------------------------------------------------
RESP=$(curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${FULL}" \
  --data-urlencode "parse_mode=Markdown" \
  -w "\nHTTP_CODE:%{http_code}\n" 2>&1)

HTTP_CODE=$(echo "$RESP" | grep -oP 'HTTP_CODE:\K\d+' || echo "0")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: Telegram API HTTP $HTTP_CODE" >&2
  echo "$RESP" >&2
  exit 1
fi

# success: silent (= no stdout pollution when chained)
exit 0
