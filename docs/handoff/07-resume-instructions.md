# 07 — Resume Instructions

codex が引き継ぎを受けて議論を再開する時の具体的手順。

## Step 0: 引き継ぎ docs 全部読む

順番:

1. `HANDOFF.md` (= repo root、 全体地図 + 1 分 summary)
2. `docs/handoff/00-overview.md` (= プロジェクト全体像)
3. `docs/handoff/01-current-state.md` (= 現状 state)
4. `docs/handoff/02-key-decisions.md` (= 主要意思決定)
5. `docs/handoff/03-audit-findings.md` (= Block extension audit evidence)
6. `docs/handoff/04-external-systems.md` (= URLs / IDs)
7. `docs/handoff/05-pending-tasks.md` (= 残作業)
8. `docs/handoff/06-workflow-rules.md` (= collaboration rules)
9. `docs/handoff/07-resume-instructions.md` (= 本ファイル)

claude memory も参照可:

- `/home/ubuntu/.claude/projects/-home-ubuntu/memory/MEMORY.md`
- `/home/ubuntu/.claude/projects/-home-ubuntu/memory/project_shopify_path_a_prime_completion.md`

## Step 1: 環境 health check

以下を順次実行して 「stale でない」 ことを確認:

### git state 確認

```bash
cd /home/ubuntu/uniple-checkout-shopify
git status
git log --oneline -5
```

期待: clean working tree、 latest commit on main = `77708ca` (= もしくはそれ以降に handoff docs 追加 commit あり)。

### GitHub repo 確認

```bash
gh repo view uniple-checkout/uniple-checkout-shopify 2>&1 || \
  curl -s https://api.github.com/repos/uniple-checkout/uniple-checkout-shopify | jq '.private, .updated_at'
```

期待: `"private": false`, repo accessible。

### Shopify Dev Dashboard 確認

URL: https://dev.shopify.com/dashboard/218108954/apps/362476437505/versions

期待: `uniple-checkout-29` (= 最新) が 「Released」 / 「有効」 status。 もし新 version あれば D user に確認。

### watcher 確認

```python
# RemoteTrigger tool を使う:
{action: "get", trigger_id: "trig_01DLNKXvX9roiS57wAttYuXM"}
```

期待: `enabled: true`、 next run 直近の future date、 過去 run 全部 complete (= silent status または ALERT 履歴)。

### Telegram 通知 setup 確認

```bash
# .env or relay file に credentials 入っているか確認
[[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]] && echo "ok" || echo "未設定"

# test 送信
bin/notify-telegram.sh "codex 引き継ぎ test from $(hostname)" || echo "未設定 = D user に確認"
```

詳細: `docs/handoff/08-telegram-notifications.md`。 設定漏れなら D user に「Telegram bot 作成して credentials 共有してください」 と確認。

### community thread 確認 (= 任意)

URL: https://community.shopify.dev/t/customer-account-ui-extension-static-target-not-invoked-for-embedded-app-works-for-extension-only-app-on-same-dev-shop/34643

期待: Shopify staff 反応の有無確認。 まだ未反応なら そのまま (= watcher と並んで 「監視中」 と扱う)。

## Step 2: D user に挨拶 + 状態報告

引き継ぎ完了の短い報告 + 次の action 確認:

```
codex に引き継ぎ完了しました。

確認した状態:
- GitHub repo + v0.1.0 release 公開済
- Shopify dev dashboard uniple-checkout-29 active
- watcher daily 稼働中、 ALERT なし
- community thread 反応 [なし / あり]

残作業:
- P0: dev claude に uniple.io page 追加依頼 (= 進行確認させてください、 paste 済ですか?)
- P1: community / watcher 監視
- P2: 任意 (= product feedback form 等)

次は何から進めますか？
```

D user から指示来たら 06-workflow-rules.md の作法で対応。

## Step 3: 議論再開後の典型 pattern

### pattern A: D user が新規 task 提示

例: 「real merchant 来たので install link 発行手順教えて」
→ `docs/merchant-integration-spec.md` + `docs/handoff/05-pending-tasks.md` 参照 + Partner Dashboard 手順案内。

例: 「Shopify community thread に反応来た」
→ 反応内容を D user paste → codex 評価 → action 推奨 (= 内部 log 共有 / 反論 / 質問返し)。

例: 「Payments Apps API reopen の通知来た」
→ `docs/handoff/02-key-decisions.md` 決定 5 + `docs/app-store-submission-plan.md` 参照 + Path B 再構築 plan 起動。

### pattern B: D user が既存 task 進捗確認

例: 「uniple.io page 追加 dev claude にお願いした、 状態どう？」
→ 「D user が直接 paste したのは確認済、 dev claude 側の反応次第。 何か paste 来ましたか？」

### pattern C: D user が方向転換 / 新規路線提示

例: 「やっぱり Block extension 復活させたい」
→ `docs/handoff/03-audit-findings.md` 結論 (= 真因不明、 公式 unsupported) を改めて説明、 「具体的に何を試したいですか？」 と D user 真意確認。

例: 「App Store やっぱり申請する」
→ `docs/handoff/02-key-decisions.md` 決定 5 で「Payments Apps API 必須 + 現状不可」 と確認済、 「PPP reopen 通知来ましたか？」 と確認。 もし来てなければ申請不可。

## Step 4: 議論終了 + 次回引継ぎ準備

session 終わる時、 codex は次回も引き継ぎ可能な state にしておく:

1. **memory 更新**: 重要 decision あれば `project_shopify_path_a_prime_completion.md` に追記
2. **handoff docs 更新**: 大きな state change あれば該当 docs/handoff/*.md 更新
3. **git commit**: 必要なら commit (= D user gate)
4. **todo list 整理**: TodoWrite で final state 反映

## codex 引き継ぎ時に避けるべき pitfalls

1. **Block extension 復活に時間使わない** (= 公式 unsupported + app-level 真因不明、 ROI 低)
2. **App Store 申請の準備 task 着手しない** (= 現状不可、 PPP reopen 通知来てから start)
3. **過去の codex background dispatch は使わない** (= 信頼性低、 foreground で実行)
4. **D user に既知の情報を繰り返さない** (= D user は session 全体を覚えていない場合あり、 ただし context 圧縮で transparent に handle)
5. **長文 wall of text を避ける** (= D user は短い回答好み)

## 最重要 (= 強調)

**email-only design + Custom Distribution = 確定 production model**。 D user の経営判断で確定済。 codex はこの前提を覆さず、 改善 / 拡張は **追加** で議論する。

Block 復活 / App Store 公開 / Path B 移行は すべて **追加 path** であり、 既存 v0.1.0 公開状態を維持しながら検討する。 既存 production model を破壊する提案はしない。
