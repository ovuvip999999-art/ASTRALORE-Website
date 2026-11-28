/**
 * ASTRA creative provider boundary.
 *
 * Providers are selected independently for image and video. There is no
 * implicit fallback: an unset or unknown provider fails closed.
 *
 * This module is infrastructure only. The Worker-level zero-cost guard must
 * remain in place until provider cost and shared-budget enforcement are proven.
 */

const IMAGE_MODELS = {
  "1:1": [1024, 1024],
  "9:16": [768, 1365],
  "16:9": [1365, 768]
};

function createCloudflareWorkersAiAdapter(env) {
  return {
    id: "cloudflare-workers-ai",
    async generateImage({ prompt, aspectRatio }) {
      if (!env.AI) throw new Error("The selected image provider is not configured.");
      const dimensions = IMAGE_MODELS[aspectRatio];
      if (!dimensions) throw new Error("Unsupported image aspect ratio.");
      const [width, height] = dimensions;
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(width));
      form.append("height", String(height));
      const serialized = new Response(form);
      const result = await env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
        multipart: {
          body: serialized.body,
          contentType: serialized.headers.get("content-type")
        }
      });
      if (typeof result?.image !== "string" || !result.image) {
        throw new Error("Image provider returned no image data.");
      }
      return {
        image: result.image,
        mimeType: "image/png",
        provider: this.id,
        model: "@cf/black-forest-labs/flux-2-klein-4b",
        costBasis: "provider-metered-neurons"
      };
    },
    async generateVideo({ prompt, aspectRatio }) {
      if (!env.AI) throw new Error("The selected video provider is not configured.");
      const result = await env.AI.run("xai/grok-imagine-video", {
        prompt,
        aspect_ratio: aspectRatio,
        duration: 5,
        resolution: "480p"
      });
      const videoUrl = typeof result?.result?.video === "string"
        ? result.result.video
        : typeof result?.video === "string" ? result.video : "";
      if (!videoUrl || new URL(videoUrl).protocol !== "https:") {
        throw new Error("Video provider returned no valid HTTPS video URL.");
      }
      return {
        videoUrl,
        durationSeconds: 5,
        resolution: "480p",
        provider: this.id,
        model: "xai/grok-imagine-video",
        estimatedCostUsd: 0.25,
        costBasis: "per-second"
      };
    }
  };
}

export function createCreativeProviderRegistry(env) {
  const adapters = {
    "cloudflare-workers-ai": createCloudflareWorkersAiAdapter(env)
  };

  return {
    get(kind) {
      if (kind !== "image" && kind !== "video") return null;
      const configuredId = kind === "image"
        ? env.ASTRA_IMAGE_PROVIDER
        : env.ASTRA_VIDEO_PROVIDER;
      if (typeof configuredId !== "string" || !configuredId.trim()) return null;
      return adapters[configuredId.trim()] || null;
    }
  };
}
