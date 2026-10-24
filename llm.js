import { CONFIG } from './config.js';
import { cliComplete } from './cli.js';

// Giao diện chung cho Claude / GPT / Gemini: gửi system + user, hỗ trợ vòng lặp gọi công cụ.
// tools: [{ name, description, parameters (JSON Schema) }]; handlers: { [name]: async (args) => kết quả }
const MAX_STEPS = 6;
const LIMIT_MSG = 'Không hoàn tất được sau nhiều bước.';

async function post(url, headers, body, provider) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${provider} API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function claude({ system, user, tools, handlers, max, ai }) {
  const messages = [{ role: 'user', content: user }];
  const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  for (let i = 0; i < MAX_STEPS; i++) {
    const data = await post('https://api.anthropic.com/v1/messages',
      { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
      { model: ai.model, max_tokens: max, system, messages, ...(defs.length ? { tools: defs } : {}) }, ai.provider);
    if (data.stop_reason !== 'tool_use') return data.content?.map((c) => c.text || '').join('') || '';
    messages.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const b of data.content.filter((c) => c.type === 'tool_use')) {
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await handlers[b.name](b.input)) });
    }
    messages.push({ role: 'user', content: results });
  }
  return LIMIT_MSG;
}

async function gpt({ system, user, tools, handlers, max, ai }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const defs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  for (let i = 0; i < MAX_STEPS; i++) {
    const data = await post('https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${ai.apiKey}` },
      { model: ai.model, max_completion_tokens: max, messages, ...(defs.length ? { tools: defs } : {}) }, ai.provider);
    const msg = data.choices?.[0]?.message;
    if (!msg) return '';
    if (!msg.tool_calls?.length) return msg.content || '';
    messages.push(msg);
    for (const c of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* tham số lỗi, để trống */ }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(await handlers[c.function.name](args)) });
    }
  }
  return LIMIT_MSG;
}

const upperTypes = (s) => {
  if (Array.isArray(s)) return s.map(upperTypes);
  if (s && typeof s === 'object') return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toUpperCase() : upperTypes(v)]));
  return s;
};

async function gemini({ system, user, tools, handlers, max, ai }) {
  const contents = [{ role: 'user', parts: [{ text: user }] }];
  const decl = tools.map((t) => ({ name: t.name, description: t.description, parameters: upperTypes(t.parameters) }));
  for (let i = 0; i < MAX_STEPS; i++) {
    const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`,
      { 'x-goog-api-key': ai.apiKey },
      {
        systemInstruction: { parts: [{ text: system }] }, contents,
        // Model có "thinking" tính cả token suy nghĩ vào giới hạn, nên để dư.
        generationConfig: { maxOutputTokens: Math.max(max * 4, 1024) },
        ...(decl.length ? { tools: [{ functionDeclarations: decl }] } : {}),
      }, ai.provider);
    const content = data.candidates?.[0]?.content;
    const parts = content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    contents.push(content);
    const replies = [];
    for (const { functionCall: f } of calls) {
      replies.push({ functionResponse: { name: f.name, response: { result: await handlers[f.name](f.args || {}) } } });
    }
    contents.push({ role: 'user', parts: replies });
  }
  return LIMIT_MSG;
}

const PROVIDERS = { claude, gpt, gemini };

// Provider/model của agent (nếu có) ghi đè mặc định; provider đó chưa dùng được (thiếu key, hoặc thiếu CLI) thì dùng AI mặc định.
export function resolveAI(agent = {}) {
  const cli = CONFIG.connection === 'CLI';
  const asked = String(agent.provider || '').toLowerCase();
  const want = CONFIG.aliases[asked] || asked;
  const usable = (p) => CONFIG.providers.includes(p) && (cli ? CONFIG.cliOk[p] : CONFIG.keys[p]);
  const own = usable(want);
  const provider = own ? want : CONFIG.provider;
  const fallback = own ? (cli ? CONFIG.cliModels[provider] : CONFIG.models[provider]) : CONFIG.model;
  const model = own || !asked ? agent.model || fallback : fallback;
  return cli
    ? { via: 'cli', provider, model, cmd: CONFIG.cliCmd[provider] }
    : { via: 'api', provider, model, apiKey: CONFIG.keys[provider] };
}

export function complete({ agent, system, user, tools = [], handlers = {}, max = 400 }) {
  const ai = resolveAI(agent);
  const active = tools.filter((t) => handlers[t.name]);
  if (ai.via === 'cli') return cliComplete({ system, user, tools: active, handlers, ai });
  return PROVIDERS[ai.provider]({ system, user, tools: active, handlers, max, ai });
}
