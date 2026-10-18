import { createMessage } from '../lib/model.js';

// The model is chosen here, not by the page: always the cheapest available Claude model, picked
// automatically (see lib/model.js), so visitors can't use the API key for other models or larger replies.
const MAX_TOKENS = 1000;
const MAX_QUESTION_LENGTH = 2000;

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { system, messages } = req.body || {};
  const valid = Array.isArray(messages) && messages.length > 0 && messages.length <= 10 &&
    messages.every(m => (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length <= MAX_QUESTION_LENGTH);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const { response, data } = await createMessage(apiKey, {
      max_tokens: MAX_TOKENS,
      // Short conversational answers; thinking only slows the reply and can use up the token cap.
      thinking: { type: 'disabled' },
      ...(typeof system === 'string' ? { system } : {}),
      messages
    });

    if (!response.ok) {
      console.error('Anthropic API error', response.status, data?.error?.message);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reach Anthropic API' });
  }
}
