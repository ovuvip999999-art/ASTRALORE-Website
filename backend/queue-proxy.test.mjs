import test from "node:test";
import assert from "node:assert/strict";

import { forwardQueueAction, normalizeQueueAction } from "./queue-proxy.mjs";

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const SERVER_TOKEN = "private-model-server-token-value-with-at-least-32-chars";
const AUTH = "Bearer user-session-token-value";

function createAction(overrides = {}) {
  return {
    operation: "create",
    modality: "image",
    modelId: "astra-image-test",
    aspectRatio: "1:1",
    width: 512,
    height: 512,
    brief: { prompt: "A calm blue planet", modality: "image", aspect_ratio: "1:1" },
    idempotencyKey: "request-00000001",
    costAcknowledged: true,
    ...overrides
  };
}

function enabledEnv(overrides = {}) {
  return {
    ASTRA_QUEUE_API_ENABLED: "true",
    ASTRA_MODEL_RUNTIME_READY: "true",
    ASTRA_MODERATION_READY: "true",
    ASTRA_WORKER_PROCESS_READY: "true",
    ASTRA_CREATIVE_GENERATION_APPROVED: "true",
    ASTRA_ZERO_COST_APPROVED: "true",
    ASTRA_MODEL_SERVER_URL: "https://private-model.example",
    ASTRA_MODEL_SERVER_TOKEN: SERVER_TOKEN,
    ...overrides
  };
}

test("normalizes create actions and rejects user-controlled owner fields", () => {
  const action = normalizeQueueAction(createAction());
  assert.equal(action.operation, "create");
  assert.equal(action.modelId, "astra-image-test");
  assert.throws(() => normalizeQueueAction(createAction({ user_id: "attacker" })), TypeError);
});

test("rejects invalid dimensions, aspect ratio, modality, and idempotency key", () => {
  assert.throws(() => normalizeQueueAction(createAction({ width: 640, height: 480 })), TypeError);
  assert.throws(() => normalizeQueueAction(createAction({ aspectRatio: "4:3" })), TypeError);
  assert.throws(() => normalizeQueueAction(createAction({ modality: "audio" })), TypeError);
  assert.throws(() => normalizeQueueAction(createAction({ idempotencyKey: "short" })), TypeError);
  assert.throws(() => normalizeQueueAction(createAction({ costAcknowledged: false })), TypeError);
});

test("normalizes status, cancel, and asset URL actions with UUIDs", () => {
  for (const operation of ["status", "cancel", "asset-url"]) {
    assert.deepEqual(normalizeQueueAction({ operation, jobId: JOB_ID }), { operation, jobId: JOB_ID });
  }
  assert.throws(() => normalizeQueueAction({ operation: "status", jobId: "../other" }), TypeError);
});

test("queue proxy remains disabled by default and never contacts model server", async () => {
  let calls = 0;
  const result = await forwardQueueAction(createAction(), {
    env: enabledEnv({ ASTRA_QUEUE_API_ENABLED: "false" }),
    authorization: AUTH,
    fetchImpl: async () => { calls += 1; throw new Error("must not call"); }
  });
  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});

test("create waits for model, moderation, and worker readiness flags", async () => {
  for (const key of ["ASTRA_MODEL_RUNTIME_READY", "ASTRA_MODERATION_READY", "ASTRA_WORKER_PROCESS_READY", "ASTRA_CREATIVE_GENERATION_APPROVED", "ASTRA_ZERO_COST_APPROVED"]) {
    let calls = 0;
    const env = enabledEnv({ [key]: "false" });
    const result = await forwardQueueAction(createAction(), {
      env, authorization: AUTH,
      fetchImpl: async () => { calls += 1; return new Response("{}"); }
    });
    assert.equal(result.status, 503);
    assert.equal(calls, 0);
  }
});

test("create forwards only normalized fields and keeps both credentials server-side", async () => {
  let captured;
  const result = await forwardQueueAction(createAction(), {
    env: enabledEnv(),
    authorization: AUTH,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ job_id: JOB_ID, status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.job_id, JOB_ID);
  assert.equal(captured.url, "https://private-model.example/v1/jobs");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["X-ASTRA-Server-Token"], SERVER_TOKEN);
  assert.equal(captured.options.headers.Authorization, AUTH);
  const forwarded = JSON.parse(captured.options.body);
  assert.equal(forwarded.model_id, "astra-image-test");
  assert.equal(forwarded.user_id, undefined);
  assert.equal(forwarded.idempotency_key, "request-00000001");
});

test("status, cancel, and signed asset retrieval use fixed server routes", async () => {
  const expected = [
    ["status", "GET", "/v1/jobs/" + JOB_ID],
    ["cancel", "POST", "/v1/jobs/" + JOB_ID + "/cancel"],
    ["asset-url", "GET", "/v1/jobs/" + JOB_ID + "/asset-url"]
  ];
  for (const [operation, method, suffix] of expected) {
    let captured;
    const result = await forwardQueueAction({ operation, jobId: JOB_ID }, {
      env: enabledEnv(),
      authorization: AUTH,
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
    });
    assert.equal(result.status, 200);
    assert.equal(captured.url, "https://private-model.example" + suffix);
    assert.equal(captured.options.method, method);
  }
});

test("rejects non-HTTPS model server URLs and missing server credentials", async () => {
  for (const env of [
    enabledEnv({ ASTRA_MODEL_SERVER_URL: "http://public.example" }),
    enabledEnv({ ASTRA_MODEL_SERVER_URL: "https://user:pass@private-model.example" }),
    enabledEnv({ ASTRA_MODEL_SERVER_TOKEN: "short" })
  ]) {
    let calls = 0;
    const result = await forwardQueueAction({ operation: "status", jobId: JOB_ID }, {
      env, authorization: AUTH,
      fetchImpl: async () => { calls += 1; return new Response("{}"); }
    });
    assert.equal(result.status, 503);
    assert.equal(calls, 0);
  }
});

test("requires a signed-in user session and sanitizes upstream errors", async () => {
  const missingAuth = await forwardQueueAction({ operation: "status", jobId: JOB_ID }, {
    env: enabledEnv(), authorization: "", fetchImpl: async () => new Response("{}")
  });
  assert.equal(missingAuth.status, 401);

  const failure = await forwardQueueAction({ operation: "status", jobId: JOB_ID }, {
    env: enabledEnv(), authorization: AUTH,
    fetchImpl: async () => new Response("secret internal traceback", { status: 500 })
  });
  assert.equal(failure.status, 500);
  assert.equal(failure.body.error.includes("traceback"), false);
});

test("rejects oversized and invalid upstream JSON responses", async () => {
  const oversized = await forwardQueueAction({ operation: "status", jobId: JOB_ID }, {
    env: enabledEnv(), authorization: AUTH,
    fetchImpl: async () => new Response("x".repeat(70000), { status: 200 })
  });
  assert.equal(oversized.status, 502);

  const invalid = await forwardQueueAction({ operation: "status", jobId: JOB_ID }, {
    env: enabledEnv(), authorization: AUTH,
    fetchImpl: async () => new Response("not-json", { status: 200 })
  });
  assert.equal(invalid.status, 502);
});

test("network errors return a sanitized unavailable response", async () => {
  const result = await forwardQueueAction({ operation: "status", jobId: JOB_ID }, {
    env: enabledEnv(), authorization: AUTH,
    fetchImpl: async () => { throw new Error("private credential leaked"); }
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.includes("credential"), false);
});
