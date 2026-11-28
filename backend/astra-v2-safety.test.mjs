import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("enabled skills are retrieved only for the authenticated owner", async () => {
  const worker = await read("./worker.js");
  const loaderStart = worker.indexOf("async function loadEnabledSkills");
  const loaderEnd = worker.indexOf("\nasync function releaseImageQuota", loaderStart);
  assert.notEqual(loaderStart, -1, "Worker must define the skill loader");
  assert.notEqual(loaderEnd, -1, "Skill loader boundary must remain identifiable");
  const loader = worker.slice(loaderStart, loaderEnd);

  assert.match(loader, /user_id:\s*"eq\."\s*\+\s*userId/);
  assert.match(loader, /enabled:\s*"eq\.true"/);
  assert.match(loader, /Authorization:\s*authorization/);
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

test("creative endpoints fail closed and enforce per-account quotas", async () => {
  const worker = await read("./worker.js");
  const migration = await read("./migrations/0007_astra_image_generation_quota.sql");
  const config = await read("./wrangler.toml");

  assert.match(worker, /env\.ASTRA_CREATIVE_ENABLED !== "true"/);
  assert.match(worker, /env\.ASTRA_VIDEO_ENABLED !== "true"/);
  assert.match(worker, /consumeImageQuota\(env, authorization, authenticatedUser\.id\)/);
  assert.match(worker, /consumeVideoQuota\(env, authorization, authenticatedUser\.id\)/);
  assert.match(worker, /releaseImageQuota\(env, authorization, authenticatedUser\.id\)/);
  assert.match(worker, /releaseVideoQuota\(env, authorization, authenticatedUser\.id\)/);

  assert.match(migration, /auth\.uid\(\) is null or auth\.uid\(\) <> p_user_id/i);
  assert.match(migration, /images_generated < 3/);
  assert.match(migration, /videos_generated < 1/);
  assert.match(config, /ASTRA_CREATIVE_ENABLED = "false"/);
  assert.match(config, /ASTRA_VIDEO_ENABLED = "false"/);
});

test("creative prompts are validated before generation and model failures release quota", async () => {
  const worker = await read("./worker.js");
  const studio = await read("../astra-creative-studio.js");

  assert.match(worker, /generate-image/);
  assert.match(worker, /generate-video/);
  assert.match(worker, /ASTRA video generation failed/);
  assert.match(worker, /ASTRA image generation failed/);
  assert.match(studio, /I understand/i);
  assert.match(studio, /prompt/i);
});
