import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const loader = async () => {
  const markdown = await readFile(
    resolve(process.cwd(), "docs/merchant-integration-spec.md"),
    "utf8",
  );

  return new Response(markdown, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
