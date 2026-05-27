# Changelog

All notable changes to uniple checkout for Shopify will be documented in this file.

このプロジェクトの形式は [Keep a Changelog](https://keepachangelog.com/) に準拠し、
[Semantic Versioning](https://semver.org/) を採用しています。

## [0.1.0] - 2026-05-26

### Added

- 初回 GitHub public release (= Custom Distribution 配布、 App Store 未公開)
- Manual Payment integration: 「uniple checkout (JPYC)」 を手動の決済方法として merchant が有効化
- Liquid snippet for Order Confirmation email (= JPYC blue button #16449A、 customer が email から uniple checkout に遷移)
- App Proxy `/apps/uniple-pay-link` (= lazy session create + redirect to uniple checkout)
- Webhook handlers:
  - `orders/create`: pending Manual Payment order の uniple checkout session 作成 + metafield 書込
  - `uniple.checkout.session.completed`: orderMarkAsPaid mutation で Shopify order を paid 化
  - `uniple.checkout.session.expired`: OrderMapping を `pending → expired` で cleanup
- Settings page: per-shop credentials (= `apiBaseUrl` / `apiKey` / `webhookSecret` / `merchantLabel` / `mode`)
- App welcome page: Setup status check (= 「Ready」 / 「Setup required」) + Setup guide + 加盟店申請 form link
- Return handler `/api/uniple-return`: uniple checkout 完了後の Shopify `Order.statusPageUrl` 3-tier fallback redirect
- Documentation:
  - `docs/merchant-integration-spec.md`: merchant 向け install + setup 詳細
- JPYC compliance:
  - 「日本円ステーブルコイン」 / 「電子決済手段」 表記、 「暗号資産」 表記不使用
  - 資金決済法第 2 条第 5 項 / JPYC 株式会社 関東財務局長第 99 号 準拠

### Design decisions

- **Email-only design 採択**: customer 動線は注文確認 email の 「JPYC のお支払いに進む」 button のみ。 Thank you page / Customer Account Order Status page には支払 button を表示せず。
- **Custom Distribution 配布**: cryptocurrency 決済 app の App Store 申請は Payments Apps API + Approved Payments Partner 承認必要 (= 現状 invitation-only)。 当面は uniple 加盟店申請 form 経由で merchant 個別 install link 発行で運用。
- **scope は最小**: `read_orders, write_orders` のみ。 `write_products` 等は不要。
