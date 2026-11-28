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

test("creative endpoints enforce owner, free, premium, and rolling 24-hour plans", async () => {
  const worker = await read("./worker.js");
  const initialMigration = await read("./migrations/0007_astra_image_generation_quota.sql");
  const ownerBudgetMigration = await read("./migrations/0008_astra_creative_owner_budget.sql");
  const plansMigration = await read("./migrations/0009_astra_free_and_premium_plans.sql");
  const config = await read("./wrangler.toml");

  assert.match(worker, /env\\.ASTRA_CREATIVE_ENABLED !== "true"/);
  assert.match(worker, /env\\.ASTRA_VIDEO_ENABLED !== "true"/);
  assert.match(worker, /reserveCreativeUsage\\(env, authorization, authenticatedUser\\.id, "image"\\)/);
  assert.match(worker, /reserveCreativeUsage\\(env, authorization, authenticatedUser\\.id, "video"\\)/);
  assert.match(worker, /authenticatedUser\\.id === env\\.ASTRA_CREATIVE_OWNER_USER_ID\\.trim\\(\\)/);
  assert.match(worker, /quota = \\{ allowed: true, remaining: -1, unlimited: true \\}/);
  assert.doesNotMatch(worker, /authenticatedUser\\.id !== env\\.ASTRA_CREATIVE_OWNER_USER_ID/);

  assert.match(initialMigration, /auth\\.uid\\(\\) is null or auth\\.uid\\(\\) <> p_user_id/i);
  assert.match(ownerBudgetMigration, /estimated_spend_usd/);
  assert.match(plansMigration, /create table if not exists public\\.astra_user_plans/i);
  assert.match(plansMigration, /plan in \\('free', 'premium'\\)/i);
  assert.match(plansMigration, /generated_at > now\\(\\) - interval '24 hours'/i);
  assert.match(plansMigration, /v_limit integer := 10/);
  assert.match(plansMigration, /v_is_premium/);
  assert.match(plansMigration, /return query select true, null::integer, null::numeric, true/i);
  assert.match(plansMigration, /pg_advisory_xact_lock/);
  assert.match(plansMigration, /revoke all on function public\\.astra_release_image_generation\\(uuid\\) from public, anon, authenticated/i);
  assert.match(plansMigration, /revoke all on function public\\.astra_release_video_generation\\(uuid\\) from public, anon, authenticated/i);
  assert.match(config, /ASTRA_CREATIVE_ENABLED = "false"/);
  assert.match(config, /ASTRA_VIDEO_ENABLED = "false"/);
});

test("creative prompts are validated and failed model calls keep their reservation", async () => {
  const worker = await read("./worker.js");
  const studio = await read("../astra-creative-studio.js");
  const html = await read("../astra.html");

  assert.match(worker, /generate-image/);
  assert.match(worker, /generate-video/);
  assert.match(worker, /ASTRA video generation failed/);
  assert.match(worker, /ASTRA image generation failed/);
  assert.match(html, /I understand image generation uses Cloudflare AI usage/i);
  assert.ok(html.includes("I understand this video request may create a US$0.25 AI charge"));
  assert.match(studio, /prompt/i);
});
