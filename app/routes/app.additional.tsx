const SETUP_DOC_PATH = "/docs/merchant-integration-spec";
const MERCHANT_APPLICATION_URL = "https://forms.gle/b8kwVZeynA1ffV8j6";

export default function ResourcesPage() {
  return (
    <s-page heading="Resources">
      <s-section heading="Merchant resources">
        <s-unordered-list>
          <s-list-item>
            <s-link href={SETUP_DOC_PATH} target="_blank">
              Merchant integration spec
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/settings">Settings</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href={MERCHANT_APPLICATION_URL} target="_blank">
              uniple merchant application
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="mailto:support@uniple.io">support@uniple.io</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
