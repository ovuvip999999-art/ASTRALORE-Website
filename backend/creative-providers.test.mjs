import test from "node:test";
import assert from "node:assert/strict";
import { createCreativeProviderRegistry } from "./creative-providers.js";

test("provider registry fails closed when no provider is explicitly selected", () => {
  const registry = createCreativeProviderRegistry({ AI: { run() { throw new Error("must not run"); } } });
  assert.equal(registry.get("image"), null);
  assert.equal(registry.get("video"), null);
});

test("provider registry does not silently fall back for unknown providers", () => {
  const registry = createCreativeProviderRegistry({
    ASTRA_IMAGE_PROVIDER: "unknown-provider",
    ASTRA_VIDEO_PROVIDER: "unknown-provider",
    AI: { run() { throw new Error("must not run"); } }
  });
  assert.equal(registry.get("image"), null);
  assert.equal(registry.get("video"), null);
});

test("Cloudflare image adapter normalizes output behind the provider boundary", async () => {
  let calledModel = "";
  const registry = createCreativeProviderRegistry({
    ASTRA_IMAGE_PROVIDER: "cloudflare-workers-ai",
    AI: {
      async run(model) {
        calledModel = model;
        return { image: "ZmFrZS1pbWFnZQ==" };
      }
    }
  });
  const provider = registry.get("image");
  assert.ok(provider);
  const result = await provider.generateImage({ prompt: "A calm starry sky", aspectRatio: "1:1" });
  assert.equal(calledModel, "@cf/black-forest-labs/flux-2-klein-4b");
  assert.equal(result.image, "ZmFrZS1pbWFnZQ==");
  assert.equal(result.provider, "cloudflare-workers-ai");
  assert.equal(result.costBasis, "provider-metered-neurons");
});

test("Cloudflare video adapter reports its metered cost and validates HTTPS output", async () => {
  let calledModel = "";
  const registry = createCreativeProviderRegistry({
    ASTRA_VIDEO_PROVIDER: "cloudflare-workers-ai",
    AI: {
      async run(model) {
        calledModel = model;
        return { result: { video: "https://media.example/video.mp4" } };
      }
    }
  });
  const provider = registry.get("video");
  assert.ok(provider);
  const result = await provider.generateVideo({ prompt: "A comet crossing space", aspectRatio: "16:9" });
  assert.equal(calledModel, "xai/grok-imagine-video");
  assert.equal(result.videoUrl, "https://media.example/video.mp4");
  assert.equal(result.estimatedCostUsd, 0.25);
  assert.equal(result.costBasis, "per-second");
});

test("video adapter rejects non-HTTPS output", async () => {
  const registry = createCreativeProviderRegistry({
    ASTRA_VIDEO_PROVIDER: "cloudflare-workers-ai",
    AI: { async run() { return { video: "http://unsafe.example/video.mp4" }; } }
  });
  await assert.rejects(
    registry.get("video").generateVideo({ prompt: "A comet crossing space", aspectRatio: "16:9" }),
    /valid HTTPS/
  );
});


test("ASTRA self-hosted image adapter sends the provider-independent request contract", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, "Bearer test-secret");
    return new Response(JSON.stringify({
      imageBase64: "ZmFrZS1pbWFnZQ==",
      mimeType: "image/png",
      model: "astra-image-dev"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const registry = createCreativeProviderRegistry({
      ASTRA_IMAGE_PROVIDER: "astra-self-hosted",
      ASTRA_IMAGE_MODEL_URL: "https://models.example/v1/image",
      ASTRA_MODEL_SERVER_TOKEN: "test-secret"
    });
    const result = await registry.get("image").generateImage({
      prompt: "A quiet nebula",
      aspectRatio: "16:9"
    });
    assert.equal(requestUrl, "https://models.example/v1/image");
    assert.deepEqual(requestBody, {
      task: "image",
      prompt: "A quiet nebula",
      aspectRatio: "16:9",
      output: "base64"
    });
    assert.equal(result.provider, "astra-self-hosted");
    assert.equal(result.model, "astra-image-dev");
    assert.equal(result.image, "ZmFrZS1pbWFnZQ==");
    assert.equal(result.costBasis, "self-hosted-infrastructure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ASTRA self-hosted video adapter accepts only HTTPS output", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-secret");
    return new Response(JSON.stringify({
      videoUrl: "https://media.example/clip.mp4",
      model: "astra-video-dev"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const registry = createCreativeProviderRegistry({
      ASTRA_VIDEO_PROVIDER: "astra-self-hosted",
      ASTRA_VIDEO_MODEL_URL: "https://models.example/v1/video",
      ASTRA_MODEL_SERVER_TOKEN: "test-secret"
    });
    const result = await registry.get("video").generateVideo({
      prompt: "A comet crossing space",
      aspectRatio: "16:9"
    });
    assert.equal(result.videoUrl, "https://media.example/clip.mp4");
    assert.equal(result.provider, "astra-self-hosted");
    assert.equal(result.model, "astra-video-dev");
    assert.equal(result.costBasis, "self-hosted-infrastructure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ASTRA self-hosted adapter rejects insecure or missing model server configuration", async () => {
  const registry = createCreativeProviderRegistry({
    ASTRA_IMAGE_PROVIDER: "astra-self-hosted",
    ASTRA_IMAGE_MODEL_URL: "http://models.example/v1/image",
    ASTRA_MODEL_SERVER_TOKEN: "test-secret"
  });
  await assert.rejects(
    registry.get("image").generateImage({ prompt: "A quiet nebula", aspectRatio: "1:1" }),
    /HTTPS URL/
  );

  const missingTokenRegistry = createCreativeProviderRegistry({
    ASTRA_IMAGE_PROVIDER: "astra-self-hosted",
    ASTRA_IMAGE_MODEL_URL: "https://models.example/v1/image"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not run without a token");
  };
  try {
    await assert.rejects(
      missingTokenRegistry.get("image").generateImage({ prompt: "A quiet nebula", aspectRatio: "1:1" }),
      /not configured/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
