import { languageNameForPrompt } from '../i18n/translations.js';

/**
 * Optional online commentary. This is deliberately fire-and-forget:
 * templates are already on screen before this is called, and every failure
 * (offline, timeout, bad key, malformed response) simply keeps the templates.
 */
export async function requestLlmCommentary({
  baseUrl,
  apiKey,
  model,
  lang,
  context,
  timeoutMs = 3000,
}) {
  if (!apiKey) throw new Error('No API key');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Offline');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `${String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.8,
        max_tokens: 90,
        messages: [
          {
            role: 'system',
            content: [
              'You are a concise live chess commentator for a projector audience at a tournament.',
              'Reply with 1-2 short sentences, no markdown, no quotation marks, no emojis.',
              `Write in ${languageNameForPrompt(lang)}.`,
              'Be dramatic but accurate. Use only the facts in the provided JSON context.',
              'Do not invent moves, pieces, or evaluations.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify(context),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('Empty commentary');

    return raw
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 320);
  } finally {
    clearTimeout(timer);
  }
}
