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
