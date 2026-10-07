// Offline tests: fetch is replaced, so nothing is sent and no key is needed. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageClient, ImageApiError, estimateCost } from "../src/index.js";

// A PNG header for a 3840x2160 image and a tiny JPEG with a 1024x576 frame.
const png4k = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x0f, 0, 0, 0, 0x08, 0x70]);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { status: 200, body: { data: [{ b64_json: b64(png4k) }] } };
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  };
  return { fn, calls };
}

const client = (fetch, extra = {}) => new ImageClient({ apiKey: "k", baseURL: "https://api.test/v1", fetch, sleep: async () => {}, ...extra });

test("GPT Image sends size and quality, and bills by the returned pixels", async () => {
  const { fn, calls } = fakeFetch([]);
  const result = await client(fn).generate({ model: "gpt-image-2", prompt: "a fox, 16:9 composition", size: "3840x2160", quality: "high", responseFormat: "b64_json" });
  assert.equal(calls[0].url, "https://api.test/v1/images/generations");
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: "gpt-image-2", prompt: "a fox, 16:9 composition", size: "3840x2160", quality: "high", response_format: "b64_json" });
  assert.equal(calls[0].init.headers.Authorization, "Bearer k");
  assert.equal(result.images[0].mimeType, "image/png");
  assert.equal(result.cost, 0.02);
});

test("Nano Banana sends aspect_ratio and resolution and is priced per tier", async () => {
  const { fn, calls } = fakeFetch([{ body: { data: [{ b64_json: "AAAA" }, { b64_json: "AAAA" }] } }]);
  const result = await client(fn).generate({ model: "nano-banana-2", prompt: "a lantern", aspectRatio: "8:1", resolution: "4k", n: 2 });
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: "nano-banana-2", prompt: "a lantern", aspect_ratio: "8:1", resolution: "4k", n: 2 });
  assert.equal(result.cost, 0.05);
});

test("requests a model would refuse never leave the process", async () => {
  const { fn, calls } = fakeFetch([]);
  const c = client(fn);
  await assert.rejects(c.generate({ model: "nano-banana-pro", prompt: "x", aspectRatio: "8:1" }), /aspectRatio 8:1/);
  await assert.rejects(c.generate({ model: "nano-banana-2-lite", prompt: "x", resolution: "2k" }), /resolution 2k/);
  await assert.rejects(c.generate({ model: "gpt-image-2", prompt: "x", aspectRatio: "16:9" }), /size in pixels/);
  await assert.rejects(c.generate({ model: "nano-banana-2", prompt: "x", responseFormat: "url" }), /responseFormat/);
  await assert.rejects(c.edit({ model: "grok-imagine-image", prompt: "x", images: ["https://a", "https://b", "https://c", "https://d"] }), /at most 3/);
  assert.equal(calls.length, 0);
});

test("edits with links go as JSON image_url objects", async () => {
  const { fn, calls } = fakeFetch([{ body: { data: [{ url: "https://cdn.test/1.png" }] } }]);
  const result = await client(fn).edit({ model: "grok-imagine-image-2.0", prompt: "same scene at night", images: ["https://e.test/a.png"], aspectRatio: "4:3", quality: "low" });
  assert.equal(calls[0].url, "https://api.test/v1/images/edits");
  assert.deepEqual(JSON.parse(calls[0].init.body).images, [{ image_url: "https://e.test/a.png" }]);
  assert.equal(result.images[0].url, "https://cdn.test/1.png");
});

test("local files and bytes go as multipart image[] parts with an optional mask", async () => {
  const dir = await mkdtemp(join(tmpdir(), "refs-"));
  await writeFile(join(dir, "room.png"), png4k);
  const { fn, calls } = fakeFetch([]);
  await client(fn).edit({ model: "gpt-image-2.5-sunburst", prompt: "add a sofa", images: [join(dir, "room.png"), png4k], mask: png4k, size: "1024x1024" });
  const form = calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.getAll("image[]").length, 2);
  assert.equal(form.getAll("image[]")[0].name, "room.png");
  assert.equal(form.get("mask").type, "image/png");
  assert.equal(form.get("size"), "1024x1024");
  assert.equal(calls[0].init.headers["Content-Type"], undefined); // fetch sets the multipart boundary
});

test("a mix of a link and a local file becomes JSON with a data URL", async () => {
  const { fn, calls } = fakeFetch([]);
  await client(fn).edit({ model: "nano-banana-pro", prompt: "merge", images: ["https://e.test/a.png", png4k] });
  const images = JSON.parse(calls[0].init.body).images;
  assert.match(images[1].image_url, /^data:image\/png;base64,/);
});

test("429 and 503 are retried after Retry-After; other errors surface with status and body", async () => {
  const waits = [];
  const { fn, calls } = fakeFetch([
    { status: 429, headers: { "retry-after": "3" }, body: { error: { message: "slow down" } } },
    { status: 200, body: { data: [{ b64_json: b64(png4k) }] } },
  ]);
  await client(fn, { sleep: async (ms) => waits.push(ms) }).generate({ model: "gpt-image-2", prompt: "x" });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [3000]);

  const failing = fakeFetch([{ status: 400, body: { error: { message: "bad size" } } }]);
  await assert.rejects(client(failing.fn).generate({ model: "gpt-image-2", prompt: "x", size: "1024x1024" }),
    (error) => error instanceof ImageApiError && error.status === 400 && error.body.error.message === "bad size");
});

test("estimates follow each family's pricing", () => {
  assert.equal(estimateCost("gpt-image-2", { size: "2560x1440", n: 2 }), 0.04);
  assert.equal(estimateCost("nano-banana-pro", { resolution: "4k", n: 3 }), 0.09);
  assert.equal(estimateCost("grok-imagine-image-2.0", { resolution: "1.5k", n: 10 }), 0.15);
});
