// Feasibility test 3: a small in-browser AI model as the coach voice.
// Question: given only verified facts, can it explain a line in plain words,
// follow "don't give the answer" for hints, and turn a typed plan into JSON,
// without inventing chess facts? Each answer gets an automatic claim check.
import { ask, checkWebGpu, fullModelId, loadLlm, MODELS } from '../engine/llm';
import { checkAnswer, SYSTEM_PROMPT, TASKS, verifyTasks } from './llm-tasks';
import { makeLogger } from './util';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function runLlmTest(out: HTMLElement, modelId: string): Promise<void> {
  const log = makeLogger(out);
  const model = MODELS.find((m) => m.id === modelId)!;
  log(`<h2>Coach voice · ${model.label}</h2>`);

  verifyTasks();
  log('<p>Task facts verified on the board with chess.js.</p>');

  const gpu = await checkWebGpu();
  log(`<p>WebGPU: ${escapeHtml(gpu.description)}</p>`);
  if (!gpu.ok) {
    log('<p class="err">No WebGPU: this device would use template comments.</p>');
    return;
  }

  const fullId = fullModelId(model.id, gpu.f16);
  const progress = document.createElement('p');
  out.append(progress);
  const t0 = performance.now();
  const engine = await loadLlm(fullId, (text) => (progress.textContent = text));
  progress.innerHTML = `<b>${fullId}</b> ready in <b>${((performance.now() - t0) / 1000).toFixed(1)} s</b>
    (first visit includes the download; later visits load from the cache)`;

  let totalTokens = 0;
  let totalMs = 0;
  for (const task of TASKS) {
    const reply = await ask(engine, fullId, SYSTEM_PROMPT, task.prompt, { jsonSchema: task.jsonSchema });
    totalTokens += reply.tokens;
    totalMs += reply.timeMs;
    const problems = checkAnswer(task, reply.text);
    log(`<div class="task">
      <h3>${task.name}</h3>
      <p class="goal">Good answer: ${escapeHtml(task.goal)}</p>
      <blockquote>${escapeHtml(reply.text).replace(/\n/g, '<br>')}</blockquote>
      <p>${(reply.timeMs / 1000).toFixed(1)} s · ${reply.tokens} tokens ·
        ${problems.length ? `<span class="err">Check: ${escapeHtml(problems.join('; '))}</span>` : '<span class="ok">Check: passed</span>'}</p>
    </div>`);
  }
  log(`<p>Average speed: <b>${((totalTokens / totalMs) * 1000).toFixed(1)} tokens/s</b></p>`);
  await engine.unload();
}
