const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const RATIOS = new Set(["1:1", "9:16", "16:9"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function normalizeQueueAction(value) {
  if (!isPlainObject(value) || typeof value.operation !== "string") {
    throw new TypeError("Invalid queue action.");
  }

  if (value.operation === "create") {
    const keys = ["operation", "modality", "modelId", "aspectRatio", "width", "height", "brief", "idempotencyKey"];
    if (!hasExactKeys(value, keys)) throw new TypeError("Queue create action contains missing or unknown fields.");
    if (!["image", "video"].includes(value.modality)) throw new TypeError("Invalid queue modality.");
    if (typeof value.modelId !== "string" || !MODEL_ID_RE.test(value.modelId)) throw new TypeError("Invalid model ID.");
    if (!RATIOS.has(value.aspectRatio)) throw new TypeError("Invalid aspect ratio.");
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height) ||
        value.width < 64 || value.height < 64 || value.width > 16384 || value.height > 16384 ||
        value.width * value.height > 100000000) {
      throw new TypeError("Invalid output dimensions.");
    }
    const expectedRatio = value.aspectRatio === "1:1" ? 1 : value.aspectRatio === "9:16" ? 9 / 16 : 16 / 9;
    if (Math.abs(value.width / value.height - expectedRatio) > 0.02) {
      throw new TypeError("Output dimensions do not match the aspect ratio.");
    }
    if (!isPlainObject(value.brief)) throw new TypeError("Creative brief must be an object.");
    let briefSize;
    try {
      briefSize = new TextEncoder().encode(JSON.stringify(value.brief)).length;
    } catch {
      throw new TypeError("Creative brief is not valid JSON.");
    }
    if (briefSize < 2 || briefSize > 32768) throw new TypeError("Creative brief is too large.");
    if (typeof value.idempotencyKey !== "string" || !IDEMPOTENCY_RE.test(value.idempotencyKey)) {
      throw new TypeError("Invalid idempotency key.");
    }
    return {
      operation: "create",
      modality: value.modality,
      modelId: value.modelId,
      aspectRatio: value.aspectRatio,
      width: value.width,
      height: value.height,
      brief: value.brief,
      idempotencyKey: value.idempotencyKey
    };
  }

  if (["status", "cancel", "asset-url"].includes(value.operation)) {
    if (!hasExactKeys(value, ["operation", "jobId"]) ||
        typeof value.jobId !== "string" || !JOB_ID_RE.test(value.jobId)) {
      throw new TypeError("Invalid job action.");
    }
    return { operation: value.operation, jobId: value.jobId.toLowerCase() };
  }

  throw new TypeError("Unsupported queue operation.");
}

function validModelServerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password &&
      !url.search && !url.hash && (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
}

export async function forwardQueueAction(action, {
  env,
  authorization,
  fetchImpl = fetch
}) {
  let normalized;
  try {
    normalized = normalizeQueueAction(action);
  } catch (error) {
    return { status: 400, body: { error: error.message || "Invalid queue action." } };
  }

  if (env.ASTRA_QUEUE_API_ENABLED !== "true") {
    return { status: 503, body: { error: "ASTRA's private generation queue is not enabled." } };
  }
  if (normalized.operation === "create" && (
    env.ASTRA_MODEL_RUNTIME_READY !== "true" ||
    env.ASTRA_MODERATION_READY !== "true" ||
    env.ASTRA_WORKER_PROCESS_READY !== "true"
  )) {
    return { status: 503, body: { error: "ASTRA generation is not ready. No job was submitted." } };
  }

  const baseUrl = typeof env.ASTRA_MODEL_SERVER_URL === "string" ? env.ASTRA_MODEL_SERVER_URL.trim().replace(/\/$/, "") : "";
  const serverToken = typeof env.ASTRA_MODEL_SERVER_TOKEN === "string" ? env.ASTRA_MODEL_SERVER_TOKEN.trim() : "";
  if (!validModelServerUrl(baseUrl) || serverToken.trim().length < 32) {
    return { status: 503, body: { error: "ASTRA's private queue service is not configured." } };
  }
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return { status: 401, body: { error: "A signed-in ASTRA user session is required." } };
  }

  let method = "GET";
  let path = "";
  let body;
  if (normalized.operation === "create") {
    method = "POST";
    path = "/v1/jobs";
    body = {
      modality: normalized.modality,
      model_id: normalized.modelId,
      aspect_ratio: normalized.aspectRatio,
      width: normalized.width,
      height: normalized.height,
      brief: normalized.brief,
      idempotency_key: normalized.idempotencyKey
    };
  } else if (normalized.operation === "status") {
    path = "/v1/jobs/" + normalized.jobId;
  } else if (normalized.operation === "cancel") {
    method = "POST";
    path = "/v1/jobs/" + normalized.jobId + "/cancel";
  } else {
    path = "/v1/jobs/" + normalized.jobId + "/asset-url";
  }

  const headers = {
    "X-ASTRA-Server-Token": serverToken,
    "Authorization": authorization,
    "Accept": "application/json"
  };
  if (body) headers["Content-Type"] = "application/json";

  try {
    const response = await fetchImpl(baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error"
    });
    const raw = await response.text();
    if (new TextEncoder().encode(raw).length > 65536) {
      return { status: 502, body: { error: "ASTRA's private queue returned an oversized response." } };
    }
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return { status: 502, body: { error: "ASTRA's private queue returned an invalid response." } };
    }
    if (!response.ok) {
      return {
        status: response.status >= 400 && response.status <= 599 ? response.status : 502,
        body: { error: "ASTRA's private queue could not complete that request." }
      };
    }
    return { status: response.status, body: payload };
  } catch {
    return { status: 503, body: { error: "ASTRA's private queue is temporarily unavailable." } };
  }
}
