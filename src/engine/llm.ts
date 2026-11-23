// In-browser AI model for the coach voice, run with WebLLM over WebGPU.
// The model is downloaded once (from Hugging Face) and cached by the browser.
import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';

export interface ModelChoice {
  id: string; // WebLLM model id without the quantization suffix
  label: string;
}

/** Candidates for the test, smallest first. Download sizes are approximate. */
export const MODELS: ModelChoice[] = [
  { id: 'Llama-3.2-1B-Instruct', label: 'Llama 3.2 1B (~0.9 GB)' },
  { id: 'LFM2.5-1.2B-Instruct', label: 'LFM 2.5 1.2B (~0.7 GB)' },
  { id: 'Qwen3-1.7B', label: 'Qwen3 1.7B (~1.2 GB)' },
  { id: 'Qwen3.5-2B', label: 'Qwen3.5 2B (~1.4 GB)' },
  { id: 'gemma-4-E2B-it', label: 'Gemma 4 E2B (~2.5 GB)' },
  { id: 'Llama-3.2-3B-Instruct', label: 'Llama 3.2 3B (~1.8 GB)' },
  { id: 'Qwen3-4B', label: 'Qwen3 4B (~2.3 GB)' },
];

export interface GpuInfo {
  ok: boolean;
  f16: boolean;
  description: string;
}

export async function checkWebGpu(): Promise<GpuInfo> {
  // `navigator.gpu` types need @webgpu/types; a loose type is enough here.
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<any> } }).gpu;
  if (!gpu) return { ok: false, f16: false, description: 'WebGPU not available in this browser' };
  const adapter = await gpu.requestAdapter();
  if (!adapter) return { ok: false, f16: false, description: 'No WebGPU adapter' };
  const f16 = adapter.features.has('shader-f16');
  const info = adapter.info ?? {};
  return { ok: true, f16, description: `${info.vendor ?? ''} ${info.architecture ?? ''} · shader-f16: ${f16}`.trim() };
}

/** Full WebLLM id: 16-bit math when the GPU supports it, else 32-bit. */
export function fullModelId(id: string, f16: boolean): string {
  return `${id}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
}

export async function loadLlm(fullId: string, onProgress: (text: string) => void): Promise<MLCEngine> {
  return CreateMLCEngine(fullId, { initProgressCallback: (r) => onProgress(r.text) });
}

export interface Reply {
  text: string;
  timeMs: number;
  tokens: number;
}

export async function ask(
  engine: MLCEngine,
  fullId: string,
  system: string,
  user: string,
  /** `jsonSchema`: constrains the output to JSON matching this JSON Schema. */
  opts: { jsonSchema?: object; maxTokens?: number } = {},
): Promise<Reply> {
  const start = performance.now();
  const res = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: opts.maxTokens ?? 200,
    response_format: opts.jsonSchema
      ? { type: 'json_object', schema: JSON.stringify(opts.jsonSchema) }
      : undefined,
    // Qwen3 "thinks" before answering by default; the coach doesn't need that.
    extra_body: /^Qwen3|^MiniCPM/.test(fullId) ? { enable_thinking: false } : undefined,
  });
  const raw = res.choices[0]?.message.content ?? '';
  return {
    text: raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
    timeMs: performance.now() - start,
    tokens: res.usage?.completion_tokens ?? 0,
  };
}
