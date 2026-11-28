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


function configuredHttpsUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is not configured.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(label + " must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(label + " must be an HTTPS URL without embedded credentials.");
  }
  return url;
}

function createAstraSelfHostedAdapter(env) {
  async function postJson(endpoint, payload) {
    const token = typeof env.ASTRA_MODEL_SERVER_TOKEN === "string"
      ? env.ASTRA_MODEL_SERVER_TOKEN.trim()
      : "";
    if (!token) throw new Error("ASTRA's private model server is not configured.");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error("ASTRA's private model server returned HTTP " + response.status + ".");
    }
    const result = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("ASTRA's private model server returned an invalid response.");
    }
    return result;
  }

  return {
    id: "astra-self-hosted",
    async generateImage({ prompt, aspectRatio }) {
      const endpoint = configuredHttpsUrl(env.ASTRA_IMAGE_MODEL_URL, "ASTRA_IMAGE_MODEL_URL");
      const result = await postJson(endpoint, {
        task: "image",
        prompt,
        aspectRatio,
        output: "base64"
      });
      const image = typeof result.imageBase64 === "string" ? result.imageBase64 : "";
      const mimeType = typeof result.mimeType === "string" ? result.mimeType : "image/png";
      if (!image || image.length > 18000000 ||
          !["image/png", "image/jpeg", "image/webp"].includes(mimeType) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        throw new Error("ASTRA's private image model returned invalid image data.");
      }
      return {
        image,
        mimeType,
        provider: this.id,
        model: typeof result.model === "string" ? result.model.slice(0, 120) : "ASTRA self-hosted image model",
        costBasis: "self-hosted-infrastructure"
      };
    },
    async generateVideo({ prompt, aspectRatio }) {
      const endpoint = configuredHttpsUrl(env.ASTRA_VIDEO_MODEL_URL, "ASTRA_VIDEO_MODEL_URL");
      const result = await postJson(endpoint, {
        task: "video",
        prompt,
        aspectRatio,
        durationSeconds: 5,
        resolution: "480p",
        output: "https-url"
      });
      const videoUrl = typeof result.videoUrl === "string" ? result.videoUrl : "";
      let parsedUrl;
      try {
        parsedUrl = new URL(videoUrl);
      } catch {
        throw new Error("ASTRA's private video model returned an invalid video URL.");
      }
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
        throw new Error("ASTRA's private video model must return a credential-free HTTPS video URL.");
      }
      return {
        videoUrl: parsedUrl.toString(),
        durationSeconds: 5,
        resolution: "480p",
        provider: this.id,
        model: typeof result.model === "string" ? result.model.slice(0, 120) : "ASTRA self-hosted video model",
        costBasis: "self-hosted-infrastructure"
      };
    }
  };
}

export function createCreativeProviderRegistry(env) {
  const adapters = {
    "cloudflare-workers-ai": createCloudflareWorkersAiAdapter(env),
    "astra-self-hosted": createAstraSelfHostedAdapter(env)
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
