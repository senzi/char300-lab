import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const appVersion = packageJson.version;
const serviceWorker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const changelog = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

const checks = [
  ["Service Worker", serviceWorker.includes(`const APP_VERSION = "${appVersion}";`)],
  ["README", readme.includes(`${appVersion} `)],
  ["CHANGELOG", changelog.includes(`## ${appVersion} -`)],
  ["in-app changelog", main.includes(`version: "${appVersion}"`)]
];

const failed = checks.filter(([, valid]) => !valid).map(([name]) => name);
if (failed.length) {
  console.error(`Version ${appVersion} is missing or mismatched in: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Version ${appVersion} is consistent across package, app, docs, and service worker.`);
}
