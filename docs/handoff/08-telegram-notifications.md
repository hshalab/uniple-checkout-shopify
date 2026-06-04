# 08 — Telegram Notifications

codex は作業完了 / 重要 event 時に Telegram 経由で D user に通知する仕組みを持つ。 本書は setup 手順 + usage を defining。

## 概要

Telegram Bot API は単純な HTTP POST で message 送信できる:

```
POST https://api.telegram.org/bot<TOKEN>/sendMessage
  ?chat_id=<CHAT_ID>
  &text=<MESSAGE>
  &parse_mode=Markdown
```

codex は task 完了 / event 発生時に `bin/notify-telegram.sh` (= 後述) を呼ぶことで D user に通知する。

## 1. Bot 作成 (= 初回のみ、 D user 操作)

### Step 1: BotFather で bot 作成

1. Telegram で **@BotFather** (= 公式 bot 作成 service) を開く: https://t.me/BotFather
2. `/newbot` 送信
3. bot の display name 入力 (例: `uniple checkout codex notifier`)
4. bot username 入力 (= `_bot` で終わる、 例: `uniple_codex_notifier_bot`)
5. 返却される **HTTP API token** をメモ (= `1234567890:ABCdef...` 形式)

### Step 2: Chat ID 取得

1. 作成した bot を Telegram で開いて `/start` 送信 (= bot と会話 channel 開く)
2. 別 chat で **@userinfobot** (https://t.me/userinfobot) に `/start` → 自分の chat ID (= 個人 chat 用) 返却
3. または group / channel の場合: bot を追加 → `https://api.telegram.org/bot<TOKEN>/getUpdates` を browser で開いて `chat.id` を見る

### Step 3: credentials を環境に設定

option A (= 推奨、 .env 経由):

```bash
# /home/ubuntu/uniple-checkout-shopify/.env
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=-1001234567890
```

(= 既存 `.env` は `.gitignore` 済、 secret commit risk なし)

option B (= relay file 経由、 chat に paste しない pattern):

```bash
# /home/ubuntu/.rollback/uniple-telegram-credentials.md
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=-1001234567890
```

scripts は両方 source 可能 (= 後述)。

## 2. 通知 script (= codex が呼ぶ)

`bin/notify-telegram.sh` (= 本 repo 内、 後述で作成):

```bash
#!/usr/bin/env bash
# Telegram 通知 helper
# Usage:
#   bin/notify-telegram.sh "Message text"
#   bin/notify-telegram.sh -t "Custom title" "Message body"
#   echo "long stdout" | bin/notify-telegram.sh -

set -euo pipefail

# credentials を順次 source
load_creds() {
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    return 0
  fi
  for f in \
    "/home/ubuntu/uniple-checkout-shopify/.env" \
    "/home/ubuntu/.rollback/uniple-telegram-credentials.md"; do
    if [[ -f "$f" ]]; then
      set -a; source "$f"; set +a
    fi
  done
}

load_creds

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set" >&2
  exit 1
fi

# parse args
TITLE=""
if [[ "${1:-}" == "-t" ]]; then
  TITLE="$2"
  shift 2
fi

# read message (= arg or stdin)
if [[ "${1:-}" == "-" ]]; then
  MESSAGE=$(cat)
else
  MESSAGE="${1:-}"
fi

if [[ -z "$MESSAGE" ]]; then
  echo "ERROR: empty message" >&2
  exit 1
fi

# compose
if [[ -n "$TITLE" ]]; then
  FULL="*${TITLE}*\n${MESSAGE}"
else
  FULL="$MESSAGE"
fi

# send (= curl POST)
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${FULL}" \
  -d parse_mode=Markdown \
  >/dev/null
```

注: `chmod +x bin/notify-telegram.sh` 実行権限付与必要。

## 3. codex の使い方 (= 通知発火 timing)

codex は以下 timing で通知を送る:

### 必須 (= 必ず送る)

- 長時間 task の完了 (= 例: deploy 完了、 build + test 完走、 audit batch 完了)
- 重要 event (= 例: Payments Apps API reopen watcher の ALERT、 community thread reply 検知)
- error / failure (= 例: deploy fail、 test fail、 webhook error)

例:

```bash
bin/notify-telegram.sh -t "Deploy 完了" "uniple-checkout-30 released to users (commit abc123)"
bin/notify-telegram.sh -t "ALERT" "Payments Apps API watcher hit a match: ..."
bin/notify-telegram.sh -t "Error" "shopify app deploy failed with: <error message>"
```

### 任意 (= D user 設定次第)

- 通常 task 完了 (= 例: file edit 完了、 docs update 完了)
- 質問への回答返信 (= D user が即時返答必要な時)

→ 過剰通知防止のため codex は **通常 task では送らず、 「重要 task の完了」 + 「想定外 event」 のみ**を default にする。 D user が「全 task で通知ほしい」 と明示したらその通り。

## 4. claude routine 経由の通知 (= remote agent との連携)

Payments Apps API reopen watcher (= `trig_01DLNKXvX9roiS57wAttYuXM`) は内部で同 helper を call することで ALERT 通知を Telegram に送る:

```python
# routine の prompt 末尾に追加
"If ALERT condition matched, send notification:
1. Write message to /tmp/alert.txt
2. Run: /home/ubuntu/uniple-checkout-shopify/bin/notify-telegram.sh -t 'ALERT' -- < /tmp/alert.txt"
```

(= routine 環境で .env file が見えれば動く、 そうでなければ credentials を routine prompt 直書きするか別 path)

## 5. 通知 format conventions

Markdown parse_mode 採用 (= `*bold*` / `_italic_` / `` `code` `` 使える):

- title prefix: `*TITLE*` (= bold)
- timestamp prefix: `[YYYY-MM-DD HH:MM JST]`
- link は `[label](url)` 形式
- error は `*ERROR* ...` で頭飾り

例:

```
*Shopify deploy 完了*
[2026-06-04 12:34 JST]

`uniple-checkout-30` released to users.
commit: `abc123def`
message: v30 hotfix: ...

watcher status: silent (no ALERT today)
```

## 6. test (= 設定後の動作確認)

```bash
cd /home/ubuntu/uniple-checkout-shopify
bin/notify-telegram.sh "Hello from codex test"
```

→ Telegram chat に 「Hello from codex test」 message が届けば成功。

## 7. trouble shoot

| 症状 | 原因 / 対処 |
|---|---|
| `TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set` | .env / relay file に変数定義漏れ |
| `curl: (6) Could not resolve host` | network 接続 / DNS 設定 |
| HTTP 401 Unauthorized | token 誤り / bot 削除済 |
| HTTP 400 Bad Request | chat_id 誤り / bot が group chat に未追加 |
| message 届かない | bot が chat に追加されていない / silent mode |
| Markdown 崩れ | special char escape (= `_` `*` `[` `]` `(` `)` `~` ` `` ` `>` `#` `+` `-` `=` `|` `{` `}` `.` `!`) |

## 8. security / 注意

- `TELEGRAM_BOT_TOKEN` は他者に渡さない (= 渡せば任意 message 送信可能)
- bot を public group に追加する場合は admin 権限不要 (= post-only)
- 通知 message に secret (= apiKey / webhookSecret) を含めない (= log と同様)
- 通知頻度に上限あり (= Telegram API rate limit、 通常 30/sec、 注意)
