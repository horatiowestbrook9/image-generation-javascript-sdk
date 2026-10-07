// Type definitions. Each model family takes a different request shape; the unions below make the
// compiler refuse, say, `size` on Nano Banana or `aspectRatio` on GPT Image.

export type GptImageModel = "gpt-image-2" | "gpt-image-2.5-flare" | "gpt-image-2.5-sunburst";
export type NanoBananaModel = "nano-banana-pro" | "nano-banana-2" | "nano-banana-2-lite";
export type GrokImageModel = "grok-imagine-image" | "grok-imagine-image-2.0" | "grok-imagine-image-quality";
export type ImageModel = GptImageModel | NanoBananaModel | GrokImageModel;

/** A reference image: a URL or data URL, a local path (Node.js), a Blob/File, or raw bytes. */
export type ImageInput = string | Blob | Uint8Array;

interface CommonOptions {
  prompt: string;
  /** Images to return; every one is billed. GPT Image 1-7, Nano Banana 1-4, Grok 1-10. */
  n?: number;
  /** Extra body fields sent as-is, for parameters this client doesn't know yet. */
  extra?: Record<string, unknown>;
}

export interface GptImageOptions extends CommonOptions {
  model: GptImageModel;
  /** Pixels, e.g. "1024x1024", "2048x1152", "3840x2160". State the ratio in the prompt too. */
  size?: `${number}x${number}`;
  quality?: "auto" | "low" | "medium" | "high";
  responseFormat?: "url" | "b64_json";
}

export interface NanoBananaOptions extends CommonOptions {
  model: NanoBananaModel;
  /** 1:1 when left out, for edits too. nano-banana-2 adds 1:4, 4:1, 1:8 and 8:1. */
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9" | "1:4" | "4:1" | "1:8" | "8:1";
  /** nano-banana-2-lite renders 1k only. */
  resolution?: "1k" | "2k" | "4k";
  /** Base64 JPEG is the only output. */
  responseFormat?: "b64_json";
}

export interface GrokImageOptions extends CommonOptions {
  model: GrokImageModel;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "2:1" | "1:2" | "19.5:9" | "9:19.5" | "20:9" | "9:20" | "21:9" | "5:2" | "auto";
  /** 1.5k only on grok-imagine-image-2.0 and grok-imagine-image-quality. */
  resolution?: "1k" | "1.5k" | "2k";
  /** grok-imagine-image-2.0 only. */
  quality?: "low" | "medium" | "auto";
  /** URL when left out; the links are temporary. */
  responseFormat?: "url" | "b64_json";
}

export type GenerateOptions = GptImageOptions | NanoBananaOptions | GrokImageOptions;

export type EditOptions = GenerateOptions & {
  /** GPT Image up to 16, Nano Banana up to 14, Grok up to 3. */
  images: ImageInput[];
  /** GPT Image only: PNG with alpha, applied to the first image. */
  mask?: ImageInput;
};

export declare class GeneratedImage {
  /** Present when the API returned base64 (always for Nano Banana). */
  bytes?: Uint8Array;
  /** Temporary link when the API returned a URL. */
  url?: string;
  mimeType?: string;
  revisedPrompt?: string;
  /** The bytes, downloading the URL first if needed. */
  arrayBuffer(): Promise<Uint8Array>;
  /** Node.js only. */
  save(path: string): Promise<string>;
}

export interface ImageResult {
  images: GeneratedImage[];
  /** USD for the images actually returned (GPT Image: by the returned pixels when known). */
  cost?: number;
  created?: number;
}

export interface ImageClientOptions {
  /** Defaults to process.env.IMAGE_API_KEY. */
  apiKey?: string;
  /** Defaults to process.env.IMAGE_API_BASE_URL, then https://argolink.io/v1. */
  baseURL?: string;
  /** Default 600000: the API replies only when every image is finished. */
  timeoutMs?: number;
  /** Retries on 429 and 503, honouring Retry-After. Default 2. */
  maxRetries?: number;
  /** Check limits locally before sending. Default true. */
  validate?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export declare class ImageClient {
  constructor(options?: ImageClientOptions);
  generate(options: GenerateOptions): Promise<ImageResult>;
  edit(options: EditOptions): Promise<ImageResult>;
  estimate(model: ImageModel, options?: { size?: string; resolution?: string; n?: number }): number;
}

export declare class ImageApiError extends Error {
  status?: number;
  body?: unknown;
}

export interface ModelSpec {
  family: "gpt-image" | "nano-banana" | "grok-imagine";
  description: string;
  frame: "size" | "aspect_ratio";
  ratios?: string[];
  resolutions?: string[];
  quality?: string[] | null;
  maxImages: number;
  maxReferences: number;
  mask: boolean;
  formats: string[];
  editFrame: string;
  price: Record<string, number>;
}

export declare const MODELS: Record<ImageModel, ModelSpec>;
export declare const DEFAULT_BASE_URL: string;
export declare function checkRequest(model: ImageModel, options?: Record<string, unknown>): void;
export declare function estimateCost(model: ImageModel, options?: { size?: string; resolution?: string; n?: number }): number;
