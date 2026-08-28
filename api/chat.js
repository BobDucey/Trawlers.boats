// /api/chat.js
// Receives the buyer's conversation from the website and forwards it to
// Claude using the API key stored securely in Vercel's environment
// variables (never exposed to the browser). Also logs a lightweight,
// content-free chat-engagement event (site, page, session id — no message
// text) to Supabase, so we can see whether visitors are actually chatting,
// independent of whether they ever become a captured lead.

async function logChatEvent(site, page, sessionId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !sessionId) {
    return;
  }
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/chat_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        site: site || null,
        page: page || null,
        session_id: sessionId,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error('chat_events insert failed:', resp.status, body);
    }
  } catch (e) {
    // Engagement logging must never break the actual chat response.
    console.error('chat_events logging error:', e);
  }
}

export default async function handler(req, res) {
  // Allow the site to call this from the browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests are allowed' });
  }

  try {
    const { messages, system, site, page, session_id } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing or invalid "messages" array' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server is missing its Anthropic API key' });
    }

    const [anthropicRes] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          system: system || undefined,
          messages: messages,
        }),
      }),
      logChatEvent(site, page, session_id),
    ]);

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicRes.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Unexpected error in /api/chat:', err);
    return res.status(500).json({ error: 'Something went wrong on the server' });
  }
}
