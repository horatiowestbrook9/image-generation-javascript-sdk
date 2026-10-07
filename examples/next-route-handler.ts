// app/api/image/route.ts in a Next.js App Router project. The key stays on the server; the browser
// posts {prompt} and gets a data URL back.
import { ImageClient } from "image-generation-javascript-sdk";

const client = new ImageClient({ apiKey: process.env.IMAGE_API_KEY });

export async function POST(request: Request): Promise<Response> {
  const { prompt } = (await request.json()) as { prompt?: string };
  if (!prompt || prompt.length > 4000) {
    return Response.json({ error: "prompt is required (4000 characters at most)" }, { status: 400 });
  }
  const { images, cost } = await client.generate({ model: "nano-banana-2", prompt, aspectRatio: "1:1", resolution: "1k" });
  const bytes = await images[0].arrayBuffer();
  return Response.json({ image: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`, cost });
}
