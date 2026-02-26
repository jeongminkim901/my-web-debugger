const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

test("viewer loads session JSON and renders response body", async ({ page }) => {
  const rootDir = path.resolve(__dirname, "..", "..");
  const viewerUrl = pathToFileURL(path.join(rootDir, "viewer.html")).href;
  const sessionPath = path.join(rootDir, "tests", "fixtures", "sample-session.json");

  await page.goto(viewerUrl);
  await page.setInputFiles("#file", sessionPath);

  await expect(page.locator("#netCount")).toContainText("1 / 1");
  await page.locator("#network tbody tr").first().click();
  await expect(page.locator("#netDetail")).toContainText("Response Body");
  await expect(page.locator("#netDetail pre").nth(1)).toContainText("{\"pong\":true}");
});
