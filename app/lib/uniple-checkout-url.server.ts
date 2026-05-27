const DEFAULT_UNIPLE_BASE_URL = "https://uniple.io";

export function buildUnipleCheckoutUrl(
  apiBaseUrl: string | null | undefined,
  sessionId: string,
): string {
  const rawBase = apiBaseUrl?.trim() || DEFAULT_UNIPLE_BASE_URL;

  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    base = new URL(DEFAULT_UNIPLE_BASE_URL);
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  base.pathname = `${basePath}/checkout/${encodeURIComponent(sessionId)}`;
  base.search = "";
  base.hash = "";

  return base.toString();
}
