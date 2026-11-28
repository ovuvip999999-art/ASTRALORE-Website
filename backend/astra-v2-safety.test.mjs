import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("enabled skills are retrieved only for the authenticated owner", async () => {
  const worker = await read("./worker.js");
  const loaderStart = worker.indexOf("async function loadEnabledSkills");
  const loaderEnd = worker.indexOf("\nasync function reserveCreativeUsage", loaderStart);
  assert.notEqual(loaderStart, -1, "Worker must define the skill loader");
  assert.notEqual(loaderEnd, -1, "Skill loader boundary must remain identifiable");
  const loader = worker.slice(loaderStart, loaderEnd);

  assert.match(loader, /user_id:\s*"eq\."\s*\+\s*userId/);
  assert.match(loader, /enabled:\s*"eq\.true"/);
  assert.match(loader, /"Authorization":\s*authorization/);
  assert.match(loader, /limit:\s*"5"/);
  assert.match(worker, /loadEnabledSkills\(env, authorization, authenticatedUser\.id\)/);
});

test("skill management requires a signed-in user and supports enable/disable", async () => {
  const ui = await read("../astra-skills.js");
  assert.match(ui, /client\.auth\.getUser\(\)/);
  assert.match(ui, /toggle\.checked = !!skill\.enabled/);
  assert.match(ui, /updateSkill\(skill\.id, \{ enabled: toggle\.checked \}\)/);
  assert.match(ui, /\.update\(\{ \.\.\.changes, updated_at:/);
  assert.match(ui, /Only 5 skills can be enabled at once/);
});

test("skill table migration enforces per-user row-level security", async () => {
  const migration = await read("./migrations/0006_astra_user_skills.sql");
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\)\s*=\s*user_id/i);
  assert.match(migration, /with check\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
});

test("creative routes fail closed and require an explicitly selected provider", async () => {
  const worker = await read("./worker.js");
  const providers = await read("./creative-providers.js");
  const config = await read("./wrangler.toml");

  assert.match(worker, /createCreativeProviderRegistry/);
  assert.match(worker, /No approved image provider is configured/);
  assert.match(worker, /No approved video provider is configured/);
  assert.match(worker, /if \(creativeAction\) \{[\s\S]*?No creative model request was sent\./);
  const guard = worker.indexOf("No creative model request was sent.");
  const imageRoute = worker.indexOf('creativeAction?.operation === "generate-image"');
  const videoRoute = worker.indexOf('creativeAction?.operation === "generate-video"');
  assert.ok(guard >= 0 && imageRoute > guard && videoRoute > guard);
  assert.match(providers, /ASTRA_IMAGE_PROVIDER/);
  assert.match(providers, /ASTRA_VIDEO_PROVIDER/);
  assert.match(providers, /return adapters\[configuredId\.trim\(\)\] \|\| null/);
  assert.match(config, /ASTRA_CREATIVE_ENABLED = "false"/);
  assert.match(config, /ASTRA_VIDEO_ENABLED = "false"/);
  assert.doesNotMatch(config, /ASTRA_(IMAGE|VIDEO)_PROVIDER\s*=/);
});

test("creative prompts are validated and failed model calls keep their reservation", async () => {
  const worker = await read("./worker.js");
  const studio = await read("../astra-creative-studio.js");
  const html = await read("../astra.html");

  assert.match(worker, /generate-image/);
  assert.match(worker, /generate-video/);
  assert.match(worker, /ASTRA video generation failed/);
  assert.match(worker, /ASTRA image generation failed/);
  assert.match(html, /IMAGE GENERATION PAUSED/);
  assert.match(html, /VIDEO GENERATION DISABLED/);
  assert.match(html, /id="astraImageGenerate"[^>]*disabled/);
  assert.match(html, /id="astraVideoGenerate"[^>]*disabled/);
  assert.match(html, /temporarily paused/i);
  assert.match(html, /No video model requests are currently sent/i);
  assert.match(studio, /prompt/i);
});
