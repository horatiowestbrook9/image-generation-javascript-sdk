// A small client for OpenAI-style image APIs: POST /images/generations and POST /images/edits.
// Zero dependencies; runs on Node.js 18+ and in browsers (behind your own server, so the key stays secret).

import { MODELS, checkRequest, estimateCost, tierOfSize } from "./models.js";

export { MODELS, checkRequest, estimateCost };

export const DEFAULT_BASE_URL = "https://argolink.io/v1";

export class ImageApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ImageApiError";
    this.status = status;
    this.body = body;
  }
}

const isUrl = (value) => typeof value === "string" && /^(https?:|data:)/.test(value);
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "application/octet-stream";
}

function pixelEdge(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return Math.max(view.getUint32(16), view.getUint32(20));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length && bytes[i] === 0xff;) {
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return Math.max((bytes[i + 5] << 8) | bytes[i + 6], (bytes[i + 7] << 8) | bytes[i + 8]);
      }
      i += 2 + length;
    }
  }
  return undefined;
}

const base64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** One returned image: bytes when the API sent base64, a temporary URL otherwise. */
export class GeneratedImage {
  constructor({ bytes, url, revisedPrompt }) {
    this.bytes = bytes;
    this.url = url;
    this.revisedPrompt = revisedPrompt;
    this.mimeType = bytes ? sniff(bytes) : undefined;
  }

  /** Bytes, downloading the temporary URL if needed (do it promptly: the links expire). */
  async arrayBuffer() {
    if (this.bytes) return this.bytes;
    const response = await fetch(this.url);
    if (!response.ok) throw new ImageApiError(`download returned ${response.status}`, { status: response.status });
    this.bytes = new Uint8Array(await response.arrayBuffer());
    this.mimeType = sniff(this.bytes);
    return this.bytes;
  }

  /** Node.js only: write the image to disk. */
  async save(path) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, await this.arrayBuffer());
    return path;
  }
}

export class ImageClient {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]   defaults to process.env.IMAGE_API_KEY on Node.js
   * @param {string} [options.baseURL]  defaults to process.env.IMAGE_API_BASE_URL, then https://argolink.io/v1
   * @param {number} [options.timeoutMs=600000]  the API answers only when every image is finished
   * @param {number} [options.maxRetries=2]      retries on 429 and 503, honouring Retry-After
   * @param {boolean} [options.validate=true]    check model limits locally before sending
   * @param {typeof fetch} [options.fetch]
   */
  constructor(options = {}) {
    const env = typeof process !== "undefined" ? process.env : {};
    this.apiKey = options.apiKey ?? env.IMAGE_API_KEY;
    if (!this.apiKey) throw new ImageApiError("pass apiKey or set IMAGE_API_KEY");
    this.baseURL = (options.baseURL ?? env.IMAGE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.validate = options.validate ?? true;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Text to image. */
  async generate({ model, prompt, ...options }) {
    this.#check(model, options, 0);
    return this.#send("/images/generations", model, this.#fields(model, prompt, options), options);
  }

  /** Image to image. `images`: URLs, data URLs, local paths (Node.js), Blobs/Files or Uint8Arrays. */
  async edit({ model, prompt, images, mask, ...options }) {
    if (!images?.length) throw new ImageApiError("edit needs at least one reference image");
    this.#check(model, { ...options, mask }, images.length);
    const fields = this.#fields(model, prompt, options);
    const all = mask ? [...images, mask] : images;
    if (all.some(isUrl)) {
      // JSON: links as they are, anything local as a data URL. One body format per request.
      const toUrl = async (ref) => {
        if (isUrl(ref)) return ref;
        const blob = await this.#blob(ref);
        return `data:${blob.type};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
      };
      const body = { ...fields, images: await Promise.all(images.map(async (ref) => ({ image_url: await toUrl(ref) }))) };
      if (mask) body.mask = { image_url: await toUrl(mask) };
      return this.#send("/images/edits", model, body, options);
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    for (const [index, ref] of images.entries()) form.append("image[]", await this.#blob(ref), this.#name(ref, index));
    if (mask) form.append("mask", await this.#blob(mask), "mask.png");
    return this.#send("/images/edits", model, form, options);
  }

  /** Expected price in USD before sending. */
  estimate(model, options = {}) {
    return estimateCost(model, options);
  }

  #check(model, options, references) {
    if (!this.validate) return;
    checkRequest(model, { ...options, references });
  }

  #fields(model, prompt, { size, aspectRatio, resolution, quality, n, responseFormat, extra }) {
    if (!prompt) throw new ImageApiError("prompt is required");
    const fields = { model, prompt };
    if (size) fields.size = size;
    if (aspectRatio) fields.aspect_ratio = aspectRatio;
    if (resolution) fields.resolution = resolution;
    if (quality) fields.quality = quality;
    if (n) fields.n = n;
    if (responseFormat) fields.response_format = responseFormat;
    return { ...fields, ...extra };
  }

  async #blob(ref) {
    if (typeof Blob !== "undefined" && ref instanceof Blob) return ref;
    if (ref instanceof Uint8Array) return new Blob([ref], { type: sniff(ref) });
    if (typeof ref === "string") {
      const { readFile } = await import("node:fs/promises");
      const bytes = new Uint8Array(await readFile(ref));
      const extension = ref.split(".").pop().toLowerCase();
      return new Blob([bytes], { type: MIME[extension] ?? sniff(bytes) });
    }
    throw new ImageApiError("references must be URLs, paths, Blobs or Uint8Arrays");
  }

  #name(ref, index) {
    if (typeof ref === "string") return ref.split(/[\\/]/).pop();
    return ref?.name ?? `reference-${index + 1}.png`;
  }

  async #send(path, model, body, options) {
    const json = !(body instanceof FormData);
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(this.baseURL + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, ...(json ? { "Content-Type": "application/json" } : {}) },
        body: json ? JSON.stringify(body) : body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();
      if (response.ok) return this.#result(model, JSON.parse(text), options);
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt >= this.maxRetries) {
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        throw new ImageApiError(`${path} returned ${response.status}: ${text.slice(0, 300)}`, { status: response.status, body: parsed });
      }
      const wait = Number(response.headers.get("retry-after"));
      await this.sleep(Number.isFinite(wait) && wait > 0 ? wait * 1000 : 2000 * 2 ** attempt);
    }
  }

  #result(model, payload, options) {
    const images = (payload.data ?? []).map((item) => new GeneratedImage({
      bytes: item.b64_json ? base64ToBytes(item.b64_json) : undefined,
      url: item.url,
      revisedPrompt: item.revised_prompt,
    }));
    const spec = MODELS[model];
    let cost;
    if (spec) {
      cost = images.reduce((sum, image) => {
        const edge = image.bytes && spec.frame === "size" ? pixelEdge(image.bytes) : undefined;
        const tier = edge ? tierOfSize(`${edge}x${edge}`) : undefined;
        return sum + (tier ? spec.price[tier] : estimateCost(model, { ...options, n: 1 }));
      }, 0);
      cost = Math.round(cost * 10000) / 10000;
    }
    return { images, cost, created: payload.created };
  }
}
