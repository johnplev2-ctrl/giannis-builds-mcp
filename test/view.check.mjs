// Renders the MCP Apps view in a real browser with a minimal simulated host (the spec's postMessage handshake),
// fed with real results from the live server, and saves screenshots. Not part of `npm test` (needs a browser):
//   node test/view.check.mjs [mcpUrl] [outDir]      (Playwright from ../proof-page; FV_BROWSER=<chromium.exe> optional)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { client, CALLS } from "./rpc.mjs";

const require = createRequire(new URL("../../proof-page/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "https://giannis-builds-mcp.focalvero-desks.workers.dev/mcp";
const out = process.argv[3] ?? new URL("../qa/view/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
mkdirSync(out, { recursive: true });

const send = client(url);
const view = (await send("resources/read", { uri: "ui://giannis-builds/result-view-v1.html" })).message.result.contents[0].text;

const host = (result, theme) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:${theme === "dark" ? "#1f1f1e" : "#f5f4ef"};padding:16px;font:14px system-ui}
iframe{width:100%;border:1px solid ${theme === "dark" ? "#3a3a38" : "#ddd"};border-radius:12px;background:transparent;display:block}</style></head><body>
<iframe id="v" sandbox="allow-scripts" height="120"></iframe>
<script>
const result = ${JSON.stringify(result)};
const f = document.getElementById("v");
window.log = [];
window.addEventListener("message", (e) => {
  if (e.source !== f.contentWindow) return;
  const m = e.data; window.log.push(m.method || ("response " + m.id));
  if (m.method === "ui/initialize") f.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "sim-host", version: "1" }, hostCapabilities: {}, hostContext: { theme: "${theme}", displayMode: "inline" } } }, "*");
  if (m.method === "ui/notifications/initialized") {
    f.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } }, "*");
    f.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }, "*");
  }
  if (m.method === "ui/notifications/size-changed") f.style.height = m.params.height + "px";
});
f.srcdoc = ${JSON.stringify(view)};
</script></body></html>`;

const browser = await chromium.launch(process.env.FV_BROWSER ? { executablePath: process.env.FV_BROWSER } : {});
const report = [];
try {
  for (const [name, args] of Object.entries(CALLS)) {
    const result = (await send("tools/call", { name, arguments: args })).message.result;
    for (const [w, theme] of [[720, "light"], [390, "dark"]]) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: theme });
      await page.setContent(host(result, theme));
      await page.waitForFunction(() => window.log.includes("ui/notifications/initialized") && window.log.includes("ui/notifications/size-changed"), null, { timeout: 8000 });
      await page.waitForTimeout(300);
      const frame = page.frames().find((fr) => fr !== page.mainFrame());
      const text = await frame.locator("main").innerText();
      const file = `${out}/${name}-${w}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const ok = !/Waiting for the tool result|No result/.test(text) && text.length > 40;
      report.push({ name, w, theme, ok, handshake: await page.evaluate(() => window.log.slice(0, 4)), chars: text.length });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
const bad = report.filter((r) => !r.ok);
console.log(`${report.length - bad.length}/${report.length} views rendered`, bad.length ? JSON.stringify(bad) : "");
process.exit(bad.length ? 1 : 0);
