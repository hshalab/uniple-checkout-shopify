# Security Policy

## Reporting a Vulnerability

uniple checkout for Shopify における脆弱性を発見した場合、 以下までご報告ください:

- **Email**: support@uniple.io
- **公開 GitHub issue は使わない**でください (= 公開前に対応するため)

報告には以下を含めてください:
- 脆弱性の概要
- 影響範囲 (= 該当 version / merchant への影響)
- 再現手順 (= 可能なら)
- 報告者連絡先

## Acknowledgement

- **初回応答**: 5 営業日以内
- **影響度評価 + remediation timeline**: 重大度に応じて連絡
- **修正完了後**: reporter にお知らせ + (希望あれば) acknowledgement に reporter 名を記載

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | ✓ |
| < 0.1.0 | ✗ (please upgrade) |

## Security Practices

- App は Shopify OAuth + HMAC webhook signature 検証で merchant 認証
- uniple webhook は HMAC-SHA256 signature 検証で正当性確認 (= `ShopSettings.webhookSecret`)
- API credentials (= `apiKey` / `webhookSecret`) は Shopify Prisma session storage に格納
- Customer 支払い情報は uniple checkout 側 (= dev.uniple.io / uniple.io) で処理、 plugin 側に PII 永続保存しない
- plugin app 自身は customer の wallet address / 私鍵 / payment 詳細を一切扱わない

## 関連

- uniple 公式 site: https://uniple.io
- JPYC 法令準拠 (= 資金決済法第 2 条第 5 項 / 関東財務局長第 99 号)
- Shopify セキュリティ要件: https://shopify.dev/docs/apps/build/security
