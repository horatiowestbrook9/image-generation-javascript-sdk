// What each image model accepts and costs on the default endpoint (model pages, checked 2026-10-07).
// Three families with different request shapes share the same two endpoints.

const NANO_TEN = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];
const GROK_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "21:9", "5:2", "auto"];

const gptImage = (description) => ({
  family: "gpt-image",
  description,
  frame: "size", // WIDTHxHEIGHT pixels; the ratio also belongs in the prompt
  quality: ["auto", "low", "medium", "high"],
  maxImages: 7,
  maxReferences: 16,
  mask: true,
  formats: ["url", "b64_json"],
  editFrame: "size",
  // billed by the returned image's longest edge
  price: { "1k": 0.015, "2k": 0.015, "4k": 0.02 },
});

const nanoBanana = (description, ratios, price) => ({
  family: "nano-banana",
  description,
  frame: "aspect_ratio",
  ratios,
  resolutions: Object.keys(price),
  maxImages: 4,
  maxReferences: 14,
  mask: false,
  formats: ["b64_json"], // JPEG, base64 only
  editFrame: "1:1 unless aspect_ratio is sent",
  price,
});

const grok = (description, resolutions, quality) => ({
  family: "grok-imagine",
  description,
  frame: "aspect_ratio",
  ratios: GROK_RATIOS,
  resolutions,
  quality,
  maxImages: 10,
  maxReferences: 3,
  mask: false,
  formats: ["url", "b64_json"], // url when response_format is left out
  editFrame: "usually the first reference's frame unless aspect_ratio is sent",
  price: Object.fromEntries(resolutions.map((r) => [r, 0.015])),
});

export const MODELS = {
  "gpt-image-2": gptImage("text-to-image and reference editing"),
  "gpt-image-2.5-flare": gptImage("fast, high-quality everyday generation"),
  "gpt-image-2.5-sunburst": gptImage("precise generation and editing"),
  "nano-banana-pro": nanoBanana("flagship Nano Banana for finished images", NANO_TEN, { "1k": 0.03, "2k": 0.03, "4k": 0.03 }),
  "nano-banana-2": nanoBanana("everyday Nano Banana for production images", [...NANO_TEN, "1:4", "4:1", "1:8", "8:1"], { "1k": 0.02, "2k": 0.02, "4k": 0.025 }),
  "nano-banana-2-lite": nanoBanana("lightest Nano Banana for drafts and batches", NANO_TEN, { "1k": 0.01 }),
  "grok-imagine-image": grok("fast Grok generation and reference editing", ["1k", "2k"], null),
  "grok-imagine-image-2.0": grok("Grok generation with selectable quality", ["1k", "1.5k", "2k"], ["low", "medium", "auto"]),
  "grok-imagine-image-quality": grok("quality-focused Grok route (xAI retires it on 2026-11-02)", ["1k", "1.5k", "2k"], null),
};

export function tierOfSize(size) {
  const edge = Math.max(...String(size).toLowerCase().split("x").map(Number));
  if (!Number.isFinite(edge)) throw new TypeError(`size must be WIDTHxHEIGHT, got ${size}`);
  return edge <= 1024 ? "1k" : edge <= 2048 ? "2k" : "4k";
}

/** Throws a descriptive error for a request the model would refuse. */
export function checkRequest(model, { size, aspectRatio, resolution, quality, n = 1, references = 0, mask, responseFormat } = {}) {
  const spec = MODELS[model];
  if (!spec) throw new RangeError(`unknown model ${model}; known: ${Object.keys(MODELS).join(", ")}`);
  const fail = (message) => { throw new RangeError(`${model}: ${message}`); };
  if (spec.frame === "size") {
    if (aspectRatio || resolution) fail("set size in pixels (WIDTHxHEIGHT) and say the ratio in the prompt; aspectRatio/resolution are for other families");
    if (size !== undefined) tierOfSize(size);
  } else {
    if (size !== undefined) fail("use aspectRatio and resolution, not size");
    if (aspectRatio && !spec.ratios.includes(aspectRatio)) fail(`aspectRatio ${aspectRatio} is not one of ${spec.ratios.join(", ")}`);
    if (resolution && !spec.resolutions.includes(resolution)) fail(`resolution ${resolution} is not one of ${spec.resolutions.join(", ")}`);
  }
  if (quality && !(spec.quality ?? []).includes(quality)) fail(`quality ${quality} is not supported`);
  if (!Number.isInteger(n) || n < 1 || n > spec.maxImages) fail(`n must be 1-${spec.maxImages}`);
  if (references > spec.maxReferences) fail(`at most ${spec.maxReferences} reference images`);
  if (mask && !spec.mask) fail("masks are a GPT Image feature");
  if (responseFormat && !spec.formats.includes(responseFormat)) fail(`responseFormat must be ${spec.formats.join(" or ")}`);
}

/** Price of `n` images before sending; GPT Image is finalised from the returned pixels. */
export function estimateCost(model, { size, resolution, n = 1 } = {}) {
  const spec = MODELS[model];
  const tier = spec.frame === "size" ? tierOfSize(size ?? "1024x1024") : (resolution ?? "1k");
  return Math.round(spec.price[tier] * n * 10000) / 10000;
}
