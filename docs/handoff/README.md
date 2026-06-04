# docs/handoff — Codex Handoff Documents

このディレクトリは、 過去 Claude session (= ChatGPT/Claude Code) で蓄積された context を、 codex 単独で議論再開できるよう引き継ぐための docs 一式です。

## 読む順番

1. リポジトリ root の `HANDOFF.md` (= 全体地図 + 1 分 summary)
2. 本ディレクトリの各 `0X-*.md` を順番に:
   - `00-overview.md` = プロジェクト全体像
   - `01-current-state.md` = 現在の repo / deploy / release 状態
   - `02-key-decisions.md` = 主要意思決定 + 根拠
   - `03-audit-findings.md` = Block extension 不可問題の累積 audit 結果
   - `04-external-systems.md` = GitHub / Shopify dashboard / community / watcher 等の URL + ID
   - `05-pending-tasks.md` = 残作業と優先順位
   - `06-workflow-rules.md` = D user / codex collaboration rules
   - `07-resume-instructions.md` = 議論再開手順
   - `08-telegram-notifications.md` = Telegram 通知 setup + usage

## 引き継ぎ docs の更新方針

- **大きな state change 時** (= 例: 新 version deploy、 Shopify staff 反応受領、 D user 新方針) は該当 file を update
- **小さな変更** は memory file (= `/home/ubuntu/.claude/projects/-home-ubuntu/memory/project_shopify_path_a_prime_completion.md`) に追記する程度で十分
- 過剰更新は避ける (= token 節約、 docs lock-step 同期 burden)

## docs 範囲外 (= 別場所参照)

- 過去 Claude session の完全 transcript: `/home/ubuntu/.claude/projects/-home-ubuntu/8ea998ab-c506-4296-a666-74e95d0aa35e.jsonl` (= 必要時のみ tail / grep)
- 関連 plugin (= WC / EC4 / EC2) の memory: claude memory directory 内の対応する `.md`
- uniple infra (= dev claude 領域): D user 経由 paste relay
- Shopify Partner Support 履歴: D user の Help Center login 経由で過去 chat 参照可
