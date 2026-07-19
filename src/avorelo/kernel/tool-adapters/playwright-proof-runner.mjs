import { pathToFileURL } from "node:url";

const [fixturePath] = process.argv.slice(2);

if (!fixturePath) {
  process.stdout.write(JSON.stringify({ ok: false, code: "FIXTURE_REQUIRED" }));
  process.exit(2);
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  process.stdout.write(JSON.stringify({ ok: false, code: "PLAYWRIGHT_MODULE_NOT_FOUND" }));
  process.exit(10);
}

const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(fixturePath).href);
  const title = await page.title();
  const heading = await page.textContent("[data-testid='proof-heading']");
  const ctaVisible = await page.locator("[data-testid='proof-cta']").isVisible();
  process.stdout.write(JSON.stringify({
    ok: true,
    title,
    heading: heading?.slice(0, 120) ?? null,
    ctaVisible,
  }));
} finally {
  await browser.close();
}
