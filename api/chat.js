// /api/chat.js
// Receives the buyer's conversation from the website and forwards it to
// Claude using the API key stored securely in Vercel's environment
// variables (never exposed to the browser).

export default async function handler(req, res) {
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
        const { messages, system } = req.body;

      if (!messages || !Array.isArray(messages)) {
              return res.status(400).json({ error: 'Missing or invalid "messages" array' });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
                return res.status(500).json({ error: 'Server is missing its Anthropic API key' });
        }

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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
      });

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
