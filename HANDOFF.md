# Handoff Document — uniple checkout for Shopify

このドキュメントは、 uniple checkout for Shopify project の context を完全に引き継ぐためのものです。 codex (= 引き継ぎ先) は **このファイル + `docs/handoff/*.md` を順に読む**ことで、 完全な記憶と文脈を保持した状態で議論を再開できます。

最終更新: 2026-06-04 (= Claude session の最終時点)

## 引き継ぎの読み方

順番:

1. **HANDOFF.md** (= 本ファイル、 全体地図)
2. **`docs/handoff/00-overview.md`** = プロジェクト + plugin 全体像
3. **`docs/handoff/01-current-state.md`** = 現在の repo / deploy / release 状態
4. **`docs/handoff/02-key-decisions.md`** = 主要意思決定 + 根拠
5. **`docs/handoff/03-audit-findings.md`** = Block extension audit の技術的 evidence (累積 29 deploy + minimal A/B)
6. **`docs/handoff/04-external-systems.md`** = GitHub / Shopify dashboard / community / watcher 等の URL + ID
7. **`docs/handoff/05-pending-tasks.md`** = 残作業と優先順位
8. **`docs/handoff/06-workflow-rules.md`** = D user / codex / claude の collaboration rules
9. **`docs/handoff/07-resume-instructions.md`** = 議論を再開する際の手順
10. **`docs/handoff/08-telegram-notifications.md`** = Telegram 通知 setup + usage (= 作業完了 / ALERT 時に D user に通知)

加えて、 既存 claude memory も併読推奨:

- `/home/ubuntu/.claude/projects/-home-ubuntu/memory/MEMORY.md` (= index)
- `/home/ubuntu/.claude/projects/-home-ubuntu/memory/project_shopify_path_a_prime_completion.md` (= 本 plugin の最重要 memory、 累積 29 deploy + audit 全反映)

これらは過去 session で累積した record で、 内容は本 handoff の各章に要点を抽出済みですが、 原典として参照可能。

## 1 分 summary (= 緊急時の最低限)

- **plugin**: uniple checkout for Shopify (= JPYC 日本円ステーブルコイン決済 Shopify plugin)
- **state**: v0.1.0 GitHub public release 完了 (= 2026-05-27)、 Shopify dev dashboard で uniple-checkout-29 active
- **distribution**: Custom Distribution (= 加盟店申請 form 経由 install link 個別発行)、 **App Store 申請は不可**確認済 (= Payments Apps API 必須 + 現状 invitation-only)
- **design**: Email-only (= customer 動線は注文確認 email の 「JPYC のお支払いに進む」 button のみ、 Shopify UI extension 不採用)
- **真因**: customer-account UI extension が embedded uniple app で silent disable される真因確定 = app-level config (= application_url / AppDistribution explicit / Partner Dashboard 設定 のいずれか)、 community thread で escalation 待ち中
- **pending**: dev claude に uniple.io page 追加依頼 (= D user 操作残り 1 件)
- **watcher**: Payments Apps API reopen 監視 remote agent daily 動作中 (= trig_01DLNKXvX9roiS57wAttYuXM)
- **backlog**: Shopify community staff 回答 (= 内部 log 経由 真因確定) / Payments Apps API reopen / Path B (= Payments Apps V2) 再構築

## 重要 URL (= 即時参照用)

- **GitHub repo**: https://github.com/uniple-checkout/uniple-checkout-shopify
- **GitHub release**: https://github.com/uniple-checkout/uniple-checkout-shopify/releases/tag/v0.1.0
- **Shopify Dev Dashboard**: https://dev.shopify.com/dashboard/218108954/apps/362476437505
- **Community thread**: https://community.shopify.dev/t/customer-account-ui-extension-static-target-not-invoked-for-embedded-app-works-for-extension-only-app-on-same-dev-shop/34643
- **Payments Apps API reopen watcher (remote agent)**: https://claude.ai/code/routines/trig_01DLNKXvX9roiS57wAttYuXM
- **加盟店申請 form**: https://forms.gle/b8kwVZeynA1ffV8j6
- **Partner ID**: 218108954 (= uniple inc.)
- **uniple checkout app client_id**: cdf36943d96d6284bdfa212ee9801b45
- **minimal diag app client_id**: c7c56953953d5f52671b5a3d0c72cda3

## codex 引き継ぎ後の即時行動

1. 本 HANDOFF.md + docs/handoff/00-09 を全部読む
2. claude memory (`project_shopify_path_a_prime_completion.md`) を読む
3. `docs/handoff/07-resume-instructions.md` の通り initial check (= git log / Versions tab / watcher 状態確認) を実施
4. D user に「引き継ぎ完了、 何から再開しますか？」 と短く確認 (= ただし D user が既に task 指示済ならそれを優先実行)
