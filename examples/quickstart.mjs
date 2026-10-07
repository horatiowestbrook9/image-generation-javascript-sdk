// One prompt on three model families. Run: IMAGE_API_KEY=... node examples/quickstart.mjs
import { ImageClient } from "../src/index.js";

const client = new ImageClient();
const prompt = "A red vintage bicycle leaning on a sunlit brick wall";

const jobs = [
  // GPT Image: pixels in `size`, the ratio in words
  { model: "gpt-image-2", prompt: `${prompt}, 16:9 composition`, size: "2048x1152", quality: "high", responseFormat: "b64_json" },
  // Nano Banana: aspect_ratio + resolution, base64 JPEG only
  { model: "nano-banana-2", prompt, aspectRatio: "16:9", resolution: "2k" },
  // Grok Imagine: aspect_ratio + resolution, temporary URL unless you ask for b64_json
  { model: "grok-imagine-image-2.0", prompt, aspectRatio: "16:9", resolution: "2k", quality: "medium" },
];

for (const job of jobs) {
  console.log(`${job.model}: estimate $${client.estimate(job.model, job).toFixed(3)}`);
  const { images, cost } = await client.generate(job);
  const ext = images[0].mimeType === "image/jpeg" ? "jpg" : "png";
  await images[0].save(`bicycle-${job.model}.${images[0].bytes ? ext : "png"}`);
  console.log(`  saved, billed about $${cost.toFixed(3)}`);
}
