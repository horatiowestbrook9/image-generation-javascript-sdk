# Image generation JavaScript SDK — one typed client for GPT Image 2, Nano Banana and Grok Imagine

A small, unofficial JavaScript/TypeScript client for OpenAI-style image APIs (`/images/generations` and `/images/edits`). It knows that GPT Image takes pixels in `size`, that Nano Banana takes `aspect_ratio` + `resolution` and only returns base64 JPEG, that Grok Imagine edits take three references at most, and it checks each request against those rules before it can cost you anything. No dependencies; Node.js 18+ and browsers.

It is not an SDK from OpenAI, Google or xAI. If you only use OpenAI's models on OpenAI, use the official [`openai`](https://www.npmjs.com/package/openai) package; [the recipe below](#using-the-official-openai-package-instead) shows it against other endpoints too. The default endpoint is [ArgoLink](https://argolink.io/gh-image-generation-javascript-sdk), which serves all nine models in this client with one key.

<sub>Last checked: 2026-10-07 (model limits and prices in `src/models.js`).</sub>

## Features

- **Nine models, three request shapes**: GPT Image 2 / 2.5 Flare / 2.5 Sunburst, Nano Banana Pro / 2 / 2 Lite, Grok Imagine Image / 2.0 / Quality.
- **Types that encode the rules**: `size` on a Nano Banana request or `aspectRatio` on GPT Image is a compile error.
- **Local checks**: ratios, tiers, `n`, reference counts, masks and output formats per model, before sending.
- **Any reference input**: URLs, data URLs, file paths (Node.js), `Blob`/`File` and `Uint8Array`; the client picks JSON or multipart.
- **Costs**: `estimate()` before, `result.cost` after (GPT Image priced from the pixels that came back).
- **Retries** on 429 and 503 that honour `Retry-After`; a 600-second default timeout because images return only when finished.

## Install

The package isn't on the npm registry; install it from GitHub:

```bash
npm install github:horatiowestbrook9/image-generation-javascript-sdk
export IMAGE_API_KEY=your-key            # IMAGE_API_BASE_URL defaults to https://argolink.io/v1
```

## Quick start

```js
import { ImageClient } from "image-generation-javascript-sdk";

const client = new ImageClient();

const { images, cost } = await client.generate({
  model: "nano-banana-pro",
  prompt: "A ceramic teapot on linen, soft window light",
  aspectRatio: "4:3",
  resolution: "4k",
});
await images[0].save("teapot.jpg");
console.log(cost);                                   // 0.03

const edit = await client.edit({
  model: "gpt-image-2",
  prompt: "Keep the teapot, put it on a marble counter, 4:3 composition",
  images: ["teapot.jpg"],
  size: "1920x1440",
});
await edit.images[0].save("teapot-marble.png");
```

Runnable examples: [quickstart.mjs](./examples/quickstart.mjs) (one prompt on three families), [openai-package.mjs](./examples/openai-package.mjs), and a [Next.js route handler](./examples/next-route-handler.ts) that keeps the key on the server.

## Client options

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | `process.env.IMAGE_API_KEY` | sent as `Authorization: Bearer …` |
| `baseURL` | `process.env.IMAGE_API_BASE_URL`, then `https://argolink.io/v1` | any endpoint with the two Images routes |
| `timeoutMs` | `600000` | the API answers when every image is finished |
| `maxRetries` | `2` | for 429 and 503 only |
| `validate` | `true` | `false` skips the local checks (for models newer than this client) |
| `fetch` | `globalThis.fetch` | inject your own, e.g. in tests |

## Request options by model family

| Option | GPT Image 2 / 2.5 | Nano Banana | Grok Imagine Image |
|---|---|---|---|
| frame | `size: "2048x1152"` (pixels) + ratio in the prompt | `aspectRatio` (10 ratios; 14 on Nano Banana 2) | `aspectRatio` (15 ratios + `auto`) |
| tier | from `size`: longest edge ≤1024 1K, ≤2048 2K, above 4K | `resolution`: `1k` `2k` `4k` (2 Lite: `1k`) | `resolution`: `1k` `2k` (+`1.5k` on 2.0 and Quality) |
| `quality` | `auto` `low` `medium` `high` | — | `low` `medium` `auto` on 2.0 only |
| `n` | 1–7 | 1–4 | 1–10 |
| references (`edit`) | up to 16, plus optional `mask` | up to 14 | up to 3 |
| `responseFormat` | `url` or `b64_json` | `b64_json` only (JPEG) | `url` (default) or `b64_json` |
| edit frame when no ratio is sent | follows `size` | 1:1 | usually the first reference's |

`extra: {...}` adds raw body fields for parameters this client doesn't know yet.

## Edits and reference inputs

| You pass | Sent as |
|---|---|
| only URLs or data URLs | JSON: `images: [{"image_url": "…"}]` (and `mask: {"image_url": …}`) |
| only paths, `Blob`/`File` or `Uint8Array` | multipart: one `image[]` part each (and a `mask` part) |
| a mix | JSON, with the local ones turned into data URLs |

In the browser pass `File` objects from an `<input type="file">`, and send the request from your server: an API key in browser code is a public key.

## Results

`generate()` and `edit()` resolve to `{ images, cost, created }`. Each `GeneratedImage` has `bytes` (a `Uint8Array`, when the API sent base64), `url` (when it sent a temporary link), `mimeType`, `arrayBuffer()` (downloads the URL if needed; do it promptly, the links expire) and, on Node.js, `save(path)`.

## Errors and retries

Every failure is an `ImageApiError` with `status` and the parsed `body`. Local validation failures are `RangeError`s and never touch the network. 429 and 503 are retried `maxRetries` times, waiting `Retry-After` seconds when the server sends it and 2 s, 4 s, … otherwise; nothing else is retried, because a timed-out image request may still have been generated and billed.

## Model reference

| Model ID | Family | Described as | Price per image on the default endpoint | Vendor's own list price |
|---|---|---|---|---|
| `gpt-image-2` | GPT Image | text-to-image and reference editing | $0.015 (1K/2K), $0.02 (4K) | $0.006 / $0.053 / $0.211 at 1024² low / medium / high |
| `gpt-image-2.5-flare` | GPT Image | fast everyday generation | same | $0.0059 / $0.0132 / $0.0527 at 1024² low / medium / high |
| `gpt-image-2.5-sunburst` | GPT Image | precise generation and editing | same | $0.0059 / $0.0132 / $0.0527 at 1024² low / medium / high |
| `nano-banana-pro` | Nano Banana | flagship, finished images | $0.03 (1K, 2K and 4K) | $0.134 (1K/2K), $0.24 (4K) |
| `nano-banana-2` | Nano Banana | everyday production | $0.02 (1K/2K), $0.025 (4K) | $0.067 / $0.101 / $0.151 |
| `nano-banana-2-lite` | Nano Banana | drafts and batches | $0.01 (1K) | $0.0336 |
| `grok-imagine-image` | Grok Imagine | fast generation and editing | $0.015 (1K/2K) | $0.02 |
| `grok-imagine-image-2.0` | Grok Imagine | selectable quality | $0.015 (1K/1.5K/2K) | $0.04–$0.06 low, $0.06–$0.08 medium |
| `grok-imagine-image-quality` | Grok Imagine | quality route; xAI retires it on 2026-11-02 | $0.015 | $0.05–$0.07 |

<sub>All checked 2026-10-07. Default endpoint: [ArgoLink model pages](https://argolink.io/en/models/gpt-image-2). OpenAI: [image generation guide](https://developers.openai.com/api/docs/guides/image-generation), output tokens only (2.5 figures from its token calculator). Google: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), standard tier. xAI: [pricing page](https://docs.x.ai/developers/pricing) (updated 2026-09-29), output per image; xAI also charges $0.002–$0.01 per input image.</sub>

## Using the official openai package instead

The `openai` package works against any compatible base URL. GPT Image fields are standard; Nano Banana's and Grok's `aspect_ratio` and `resolution` are not in its types, so plain JavaScript sends them as written and TypeScript needs a `// @ts-expect-error` on each.

```js
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({ apiKey: process.env.IMAGE_API_KEY, baseURL: "https://argolink.io/v1", timeout: 600_000 });
const poster = await openai.images.generate({ model: "gpt-image-2", prompt: "A tide-pool poster, 3:4 composition",
  size: "1440x1920", quality: "high", response_format: "b64_json" });
const teapot = await openai.images.generate({ model: "nano-banana-pro", prompt: "A teapot", aspect_ratio: "4:3", resolution: "4k" });
const edited = await openai.images.edit({ model: "gpt-image-2", prompt: "Make it navy",
  image: [await toFile(Buffer.from(poster.data[0].b64_json, "base64"), "poster.png", { type: "image/png" })] });
```

What this client adds on top: the per-model checks and types, JSON-or-multipart selection for mixed inputs, retries scoped to 429/503, and cost per result.

## FAQ

**Why do GPT Image requests need the ratio in the prompt?**
On this API, GPT Image takes the pixel size in `size` and reads the aspect ratio from the prompt; there is no `aspect_ratio` field. Write "16:9 composition" and send `2048x1152`.

**Why does a Nano Banana edit come back square?**
Its frame defaults to 1:1 for edits too. Send `aspectRatio` every time.

**Does it work with Bun, Deno or Cloudflare Workers?**
It uses only `fetch`, `FormData`, `Blob`, `AbortSignal.timeout`, `atob` and `btoa`; file paths and `save()` need Node.js's `fs`. The tests run on Node.js only.

**How do I add a model this client doesn't list?**
Pass `validate: false` to the constructor and send its fields with `extra`. Prices and checks won't apply to it.

**Is my key safe in a React or Vue app?**
No API key is safe in browser code. Call the client from your server or an edge function, as in the Next.js example.

## Tests

```bash
npm test
```

`fetch` is replaced in the tests, so they need no key and spend nothing.

## License

MIT. Unofficial; GPT Image, Nano Banana and Grok Imagine are names of models by OpenAI, Google and xAI.
