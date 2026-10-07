// The same calls with the official `openai` npm package: only baseURL and the key change.
// npm install openai, then: IMAGE_API_KEY=... node examples/openai-package.mjs
import OpenAI, { toFile } from "openai";
import { readFile, writeFile } from "node:fs/promises";

const client = new OpenAI({
  apiKey: process.env.IMAGE_API_KEY,   // not OPENAI_API_KEY: keep an OpenAI key away from other hosts
  baseURL: "https://argolink.io/v1",
  timeout: 600_000,                    // images return only when they are finished
});

// GPT Image 2: every field is a standard Images API field.
const poster = await client.images.generate({
  model: "gpt-image-2",
  prompt: 'A minimal poster, title "TIDE POOLS" in bold serif, 3:4 composition',
  size: "1440x1920",
  quality: "high",
  response_format: "b64_json",
});
await writeFile("poster.png", Buffer.from(poster.data[0].b64_json, "base64"));

// Nano Banana uses aspect_ratio and resolution, which the SDK types don't know.
// Plain JavaScript sends them as-is; in TypeScript put `// @ts-expect-error` above each.
const banana = await client.images.generate({
  model: "nano-banana-pro",
  prompt: "A ceramic teapot on linen, soft window light",
  aspect_ratio: "4:3",
  resolution: "4k",
});
await writeFile("teapot.jpg", Buffer.from(banana.data[0].b64_json, "base64"));

// Edits: a list of files goes out as repeated image[] parts.
const edited = await client.images.edit({
  model: "gpt-image-2",
  prompt: "Keep the layout; change the palette to deep navy and coral",
  image: [await toFile(await readFile("poster.png"), "poster.png", { type: "image/png" })],
  size: "1440x1920",
  response_format: "b64_json",
});
await writeFile("poster-navy.png", Buffer.from(edited.data[0].b64_json, "base64"));
