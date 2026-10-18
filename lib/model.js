// Picks the cheapest Claude model that's currently available, so nothing needs editing when a model is
// retired. It asks Anthropic's Models API which models exist and takes the newest model of the cheapest
// family (Haiku, then Sonnet, then Opus). The choice is remembered for a few hours per server instance,
// and refreshed straight away if Anthropic says the remembered model no longer exists.

const FAMILIES = ['haiku', 'sonnet', 'opus']; // cheapest first
const REMEMBER_MS = 6 * 60 * 60 * 1000;
// Used only if the Models API itself can't be reached.
const FALLBACK_MODEL = 'claude-haiku-5-5';

let remembered = null; // { id, at }

export async function cheapestModel(apiKey, { refresh = false } = {}) {
  if (!refresh && remembered && Date.now() - remembered.at < REMEMBER_MS) {
    return remembered.id;
  }
  try {
    const models = await listModels(apiKey);
    const id = pickCheapest(models);
    if (id) {
      remembered = { id, at: Date.now() };
      return id;
    }
  } catch (error) {
    console.error('Model list failed:', error.message);
  }
  return remembered?.id || FALLBACK_MODEL;
}

/** The newest model of the cheapest family, by the model's id and release date. */
export function pickCheapest(models) {
  for (const family of FAMILIES) {
    const matches = models
      .filter(m => typeof m.id === 'string' && m.id.toLowerCase().includes(family))
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    if (matches.length) return matches[0].id;
  }
  return null;
}

async function listModels(apiKey) {
  const models = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after_id', after);
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Models API answered ${response.status}`);
    const data = await response.json();
    models.push(...(data.data || []));
    if (!data.has_more) break;
    after = data.last_id;
  }
  return models;
}

/**
 * Sends a Messages API request with the cheapest model. If Anthropic says that model doesn't exist (it was
 * retired since it was picked), picks again and retries. If a newer model rejects the thinking setting,
 * retries without it.
 */
export async function createMessage(apiKey, body, { timeoutMs = 30000 } = {}) {
  let model = await cheapestModel(apiKey);
  let request = body;
  let refreshed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ ...request, model }),
    });
    const data = await response.json();
    const message = String(data?.error?.message || '');
    if (!refreshed && response.status === 404 && data?.error?.type === 'not_found_error' && message.includes('model')) {
      console.error(`Model ${model} is no longer available; picking again.`);
      model = await cheapestModel(apiKey, { refresh: true });
      refreshed = true;
      continue;
    }
    if ('thinking' in request && response.status === 400 && message.includes('thinking')) {
      const { thinking, ...withoutThinking } = request;
      request = withoutThinking;
      continue;
    }
    return { response, data };
  }
  throw new Error('No usable Claude model answered');
}
