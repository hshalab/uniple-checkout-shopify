#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

package_version="$(
  node -e "const p = require('./package.json'); process.stdout.write(p.version || '')"
)"

changelog_version="$(
  sed -nE 's/^## \[([0-9]+\.[0-9]+\.[0-9]+)\] - .*/\1/p' CHANGELOG.md | head -n1
)"

shopify_app_version="$(
  sed -nE 's/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' shopify.app.toml | head -n1
)"

if [[ -z "${package_version}" || -z "${changelog_version}" ]]; then
  echo "Version check failed: could not read required version sources" >&2
  echo "package.json=${package_version:-missing} CHANGELOG.md=${changelog_version:-missing}" >&2
  exit 1
fi

if [[ "${package_version}" != "${changelog_version}" ]]; then
  echo "Version mismatch:" >&2
  echo "  package.json: ${package_version}" >&2
  echo "  CHANGELOG.md: ${changelog_version}" >&2
  exit 1
fi

if [[ -n "${shopify_app_version}" && "${package_version}" != "${shopify_app_version}" ]]; then
  echo "Version mismatch:" >&2
  echo "  package.json: ${package_version}" >&2
  echo "  CHANGELOG.md: ${changelog_version}" >&2
  echo "  shopify.app.toml: ${shopify_app_version}" >&2
  exit 1
fi

echo "Version ${package_version} OK"
