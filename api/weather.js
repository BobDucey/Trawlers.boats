// /api/weather.js
// Proxies requests to the NOAA/National Weather Service API so the browser
// never calls api.weather.gov directly (NOAA's API does not reliably send
// CORS headers, so direct browser-side fetches are unreliable â this proxy
// avoids that problem entirely, same reasoning as why /api/chat.js proxies
// the Claude API instead of calling it from the browser).
//
// Boating-specific upgrade: this pulls the RAW NWS gridpoint data (not the
// plain-English land forecast) so that for locations NOAA actually models as
// open water (bays, harbors, sounds) we can return real marine conditions â
// wave height, wave period, wave direction â alongside wind. For locations
// NOAA only models as land (most inland lakes/rivers), it falls back to
// standard wind + temperature conditions. The "isMarine" flag on the
// response tells the front end which one it got.
//
// Usage from the front end:
//   fetch('/api/weather?lat=44.9349&lon=-93.4653&label=Lake%20Minnetonka')
//
// NOAA requires a descriptive User-Agent identifying the application â
// update the CONTACT_EMAIL below to a real monitored address before going live.

const CONTACT_EMAIL = 'join@aiboatleads.com';
const USER_AGENT = `AI Boat Leads Weather Widget (${CONTACT_EMAIL})`;

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function degToCompass(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) return null;
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS[(idx + 16) % 16];
}

// NWS time-series entries look like { validTime: "2026-08-27T01:00:00+00:00/PT9H", value }
// â an ISO 8601 start time plus an ISO 8601 duration for how long that value holds.
function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  const days = parseInt(m[1] || 0, 10);
  const hours = parseInt(m[2] || 0, 10);
  const mins = parseInt(m[3] || 0, 10);
  const secs = parseInt(m[4] || 0, 10);
  return ((days * 24 + hours) * 60 + mins) * 60 + secs;
}

function currentValue(series) {
  if (!series || !Array.isArray(series.values) || series.values.length === 0) return null;
  const now = Date.now();
  for (const entry of series.values) {
    const [startStr, durStr] = String(entry.validTime).split('/');
    const start = new Date(startStr).getTime();
    const end = start + parseIsoDuration(durStr) * 1000;
    if (!isNaN(start) && now >= start && now < end) return entry.value;
  }
  // Nothing covers "right now" (e.g. data is slightly stale) â use the
  // earliest entry we have rather than showing nothing.
  return series.values[0].value;
}

function titleCase(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildShortForecast(weatherSeries) {
  const val = currentValue(weatherSeries);
  if (!val || !Array.isArray(val) || val.length === 0) return null;
  const first = val[0];
  if (!first || !first.weather) return null;
  const coverage = first.coverage ? titleCase(first.coverage) + ' ' : '';
  return (coverage + titleCase(first.weather)).trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET requests are allowed' });
  }

  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing required "lat" and "lon" query parameters' });
  }

  try {
    // Step 1: resolve lat/lon to the correct NOAA forecast grid endpoint
    const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/geo+json' },
    });

    if (!pointsRes.ok) {
      const errText = await pointsRes.text();
      console.error('NOAA /points error:', pointsRes.status, errText);
      return res.status(502).json({ error: 'Could not resolve location with NOAA' });
    }

    const pointsData = await pointsRes.json();
    const gridUrl = pointsData.properties?.forecastGridData;

    if (!gridUrl) {
      return res.status(502).json({ error: 'NOAA response missing grid data URL' });
    }

    // Step 2: fetch the raw gridpoint data. Unlike the plain-English
    // "/forecast" text product (which returns 404 "Marine Forecast Not
    // Supported" for points NOAA models as open water), the raw grid works
    // for both land and marine points and carries whichever fields apply.
    const gridRes = await fetch(gridUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/geo+json' },
    });

    if (!gridRes.ok) {
      const errText = await gridRes.text();
      console.error('NOAA gridpoint error:', gridRes.status, errText);
      return res.status(502).json({ error: 'Could not retrieve conditions from NOAA' });
    }

    const gridData = await gridRes.json();
    const p = gridData.properties || {};

    // A real marine grid reports wave height as a genuine multi-period time
    // series. Points NOAA only models as land (most inland lakes/rivers)
    // come back with either no waveHeight field at all, or a single flat
    // placeholder entry â that's the signal to fall back to standard
    // wind + temperature conditions instead of claiming to have wave data.
    const waveSeries = p.waveHeight;
    const isMarine = !!(waveSeries && Array.isArray(waveSeries.values) && waveSeries.values.length > 1);

    const tempC = currentValue(p.temperature);
    const windKmh = currentValue(p.windSpeed);
    const gustKmh = currentValue(p.windGust);
    const windDirDeg = currentValue(p.windDirection);
    const shortForecast = buildShortForecast(p.weather) || 'Current conditions';

    const current = {
      temperature: tempC !== null ? Math.round(tempC * 9 / 5 + 32) : null,
      temperatureUnit: 'F',
      windSpeed: windKmh !== null ? `${Math.round(windKmh * 0.621371)} mph` : null,
      windGust: gustKmh !== null ? `${Math.round(gustKmh * 0.621371)} mph` : null,
      windDirection: degToCompass(windDirDeg),
      shortForecast,
    };

    if (isMarine) {
      const waveM = currentValue(waveSeries);
      const wavePeriodSec = currentValue(p.wavePeriod);
      const waveDirDeg = currentValue(p.waveDirection);
      current.waveHeight = waveM !== null ? `${(waveM * 3.28084).toFixed(1)} ft` : null;
      current.wavePeriod = wavePeriodSec !== null ? `${Math.round(wavePeriodSec)} sec` : null;
      current.waveDirection = degToCompass(waveDirDeg);
    }

    return res.status(200).json({
      updated: new Date().toISOString(),
      isMarine,
      current,
      source: 'National Weather Service (NOAA)',
      sourceUrl: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
    });
  } catch (err) {
    console.error('Unexpected error in /api/weather:', err);
    return res.status(500).json({ error: 'Something went wrong fetching weather data' });
  }
}
