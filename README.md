# uniple checkout for Shopify

JPYC (日本円ステーブルコイン / 電子決済手段) 支払を Shopify merchant に提供する custom distribution Shopify app です。

## 概要

uniple checkout for Shopify は、 加盟店 (= merchant) の Shopify store で customer が JPYC で支払いを完了できるようにする integration app です。

- 加盟店は Shopify の **手動の決済方法** として 「uniple checkout (JPYC)」 を有効化します。
- customer は checkout で 「uniple checkout (JPYC)」 を選択し、 注文を確定します (= order pending state)。
- customer は注文確認 email の **「JPYC のお支払いに進む」 button** から uniple checkout 画面に遷移します。
- customer が wallet を接続して JPYC を送金すると、 uniple から webhook が plugin に届き、 plugin が Shopify order を `paid` に更新します。

JPYC は **日本円ステーブルコイン** / **電子決済手段** (= 資金決済法第 2 条第 5 項に基づく) であり、 JPYC 株式会社は **資金移動業者 (関東財務局長第 99 号)** として登録されています。

## 配布方法 (= Custom Distribution)

uniple checkout for Shopify は **Shopify App Store 公開ではなく、 Custom Distribution 形式**で配布しています。

理由:
- Cryptocurrency / stablecoin 決済 app は Shopify App Store に submit するには **Payments Apps API + Approved Payments Partner 承認**が必要です ([Shopify docs - blockchain apps](https://shopify.dev/docs/apps/build/blockchain))。
- Payments Apps API access は現状 **invitation-only** で application 受付が再開されるのを待機中です。
- 再開待ちの期間、 uniple は加盟店申請 form 経由で merchant 個別に install link を発行することで運用しています。

## Install

### Step 1: uniple 加盟店申請

uniple JPYC payment provider との merchant 契約が必要です。 以下 form から申請してください:

**加盟店申請 form**: https://forms.gle/b8kwVZeynA1ffV8j6

申請後、 uniple から以下を受領します:
- Shopify app の **Custom Distribution install link** (= shop-specific の OAuth URL)
- uniple API credentials (= `apiBaseUrl` / `apiKey` / `webhookSecret`)

### Step 2: Shopify shop に install

uniple から受領した install link を browser で開き、 install を承認します。

### Step 3: Setup

詳細は [docs/merchant-integration-spec.md](docs/merchant-integration-spec.md) を参照してください。 概要:

1. Shopify admin → **Apps → uniple checkout → Settings** に uniple API credentials を入力。
2. Shopify admin → **設定 → 決済 → 手動の決済方法を追加** に 「uniple checkout (JPYC)」 を追加。
3. Shopify admin → **設定 → 通知 → 注文の確認 → コードを編集** に Liquid snippet を貼り込み (= 「JPYC のお支払いに進む」 button)。
4. テスト注文で動作確認。

## Customer 動線 (= Email-only Design)

uniple checkout for Shopify は **email-only design** を採択しています。

Customer の支払 entry point は **注文確認 email の 「JPYC のお支払いに進む」 button のみ**です。 Thank you page / Customer Account Order Status page には支払 button を表示しません。 詳細は [docs/merchant-integration-spec.md](docs/merchant-integration-spec.md) を参照してください。

## 対応 Shopify plan

- Shopify Basic 以上で動作確認済み。
- Shopify Payments を併用している merchant でも 「uniple checkout (JPYC)」 を手動の決済方法として併設可能。

## 関連 plugin (= uniple 加盟店向け 4 system 配布)

- [uniple checkout for WooCommerce](https://wordpress.org/plugins/uniple-checkout-for-woocommerce/) (= WP.org 公開)
- [uniple checkout for EC-CUBE 4](https://github.com/uniple-checkout/uniple-checkout-eccube4)
- [uniple checkout for EC-CUBE 2](https://github.com/uniple-checkout/uniple-checkout-eccube2)
- uniple checkout for Shopify (= 本 repo、 Custom Distribution)

## License

[GPLv2 or later](LICENSE.md) (= 他 uniple plugin と統一)

## Security

脆弱性報告は [SECURITY.md](SECURITY.md) を参照してください。

## Support

- **加盟店申請**: https://forms.gle/b8kwVZeynA1ffV8j6
- **技術問い合わせ / 脆弱性報告**: support@uniple.io
- **uniple 公式 site**: https://uniple.io

## Trademark

- 「Shopify」 および Shopify ロゴは Shopify Inc. の登録商標です。
- 「JPYC」 および JPYC ロゴは JPYC 株式会社の登録商標です。
- 本 plugin は uniple inc. による非公式配布であり、 Shopify Inc. / JPYC 株式会社による公式認定・保証は受けていません。
