// /api/lead.js
// Receives captured lead data (email, zip, chat transcript, match summary)
// from the website and saves it into your Supabase "leads" table using the
// service role key, which is kept secret here and never sent to the browser.

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
        const { id, email, zip, site, use_case, people_aboard, location, budget_timeline, summary, messages } = req.body;

      if (!email || !zip) {
              return res.status(400).json({ error: 'email and zip are required' });
      }

      const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceKey) {
              return res.status(500).json({ error: 'Server is missing its Supabase configuration' });
      }

      // Build the row. If an "id" is passed back from a previous save, we
      // update that same row (so the chat transcript keeps growing on one
      // record instead of creating a new lead every message).
      const row = {
              email,
              zip,
              site: site || 'AluminumFishingBoats.us',
              use_case: use_case || null,
              people_aboard: people_aboard || null,
              location: location || null,
              budget_timeline: budget_timeline || null,
              summary: summary || null,
              messages: messages || [],
              updated_at: new Date().toISOString(),
      };
        if (id) row.id = id;

      const upsertRes = await fetch(`${supabaseUrl}/rest/v1/leads`, {
              method: 'POST',
              headers: {
                        'Content-Type': 'application/json',
                        'apikey': serviceKey,
                        'Authorization': `Bearer ${serviceKey}`,
                        'Prefer': 'resolution=merge-duplicates,return=representation',
              },
              body: JSON.stringify(row),
      });

      const data = await upsertRes.json();

      if (!upsertRes.ok) {
              console.error('Supabase error:', data);
              return res.status(upsertRes.status).json({ error: data.message || 'Supabase error' });
      }

      return res.status(200).json({ success: true, lead: Array.isArray(data) ? data[0] : data });
  } catch (err) {
        console.error('Unexpected error in /api/lead:', err);
        return res.status(500).json({ error: 'Something went wrong on the server' });
  }
}
