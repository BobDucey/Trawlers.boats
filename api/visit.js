// /api/visit.js
// Logs a lightweight, content-free page-view event (site, page, session_id)
// to Supabase using the service role key, which is kept secret here and
// never sent to the browser. This is fire-and-forget: it never blocks page
// rendering and a failure here must never surface as a visible error to the
// visitor, so every path returns 200.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: false });
  }

  try {
    const { site, page, session_id } = req.body || {};

    if (!session_id) {
      return res.status(200).json({ ok: false });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(200).json({ ok: false });
    }

    const resp = await fetch(`${supabaseUrl}/rest/v1/page_views`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        site: site || null,
        page: page || null,
        session_id,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('page_views insert failed:', resp.status, body);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Visit logging must never break the page it's called from.
    console.error('page_views logging error:', e);
    return res.status(200).json({ ok: false });
  }
}
