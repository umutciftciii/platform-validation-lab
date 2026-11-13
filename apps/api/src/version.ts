import { readFileSync } from "node:fs";

// Works from both src/ (tsc --noEmit) and dist/ because both sit next to package.json.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const APP_VERSION = pkg.version;
