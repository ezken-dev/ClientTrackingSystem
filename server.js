const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3000;

// ═══════════════════════════════════════════════════════
//  CREDENTIALS  (add/remove users here)
// ═══════════════════════════════════════════════════════
const USERS = {
  'Fatin69':  'Fatin69',
  'cleanboy': 'pussydestroyer',
  'EzKen':    'EzKen420',
};

// ═══════════════════════════════════════════════════════
//  GOOGLE PLACES API
// ═══════════════════════════════════════════════════════
const GOOGLE_PLACES_API_KEY = 'AIzaSyDrvtXacM9gu6nbpGXFdNa6IriyxiA9xn8';
const PLACES_API_URL        = 'https://places.googleapis.com/v1/places:searchText';

// ═══════════════════════════════════════════════════════
//  DAILY API LIMIT TRACKER
//  Each Google Places text-search page   = 1 call
//  Each Google Places detail lookup      = 1 call
//  ~350 calls / day keeps you free-tier
// ═══════════════════════════════════════════════════════
const DAILY_API_LIMIT = 350;
const DATA_DIR        = path.join(__dirname, 'data');
const USAGE_FILE      = path.join(DATA_DIR, 'api_usage.json');

let apiUsage = { date: '', count: 0 };

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadUsage() {
  try {
    ensureDataDir();
    if (fs.existsSync(USAGE_FILE))
      apiUsage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch { /* use defaults */ }
}
function saveUsage() {
  try { ensureDataDir(); fs.writeFileSync(USAGE_FILE, JSON.stringify(apiUsage)); } catch { /* ignore */ }
}
function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function resetIfNewDay() {
  if (apiUsage.date !== todayKey()) { apiUsage = { date: todayKey(), count: 0 }; saveUsage(); }
}
function getRemaining() { resetIfNewDay(); return Math.max(0, DAILY_API_LIMIT - apiUsage.count); }
function canCall(n = 1) { resetIfNewDay(); return (apiUsage.count + n) <= DAILY_API_LIMIT; }
function markCalls(n = 1) { resetIfNewDay(); apiUsage.count += n; saveUsage(); }

loadUsage();

// ═══════════════════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use(session({
  secret: 'vixa-lead-finder-secret-2024-!@#',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true }, // 8-hour session
}));

// Auth middleware for protected API routes
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'Unauthorized — please log in.' });
}

// ═══════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════

/** POST /api/login */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  if (USERS[username] && USERS[username] === password) {
    req.session.user = username;
    resetIfNewDay();
    return res.json({
      success: true, username,
      apiUsed: apiUsage.count, apiLimit: DAILY_API_LIMIT, apiRemaining: getRemaining(),
    });
  }
  return res.status(401).json({ error: 'Invalid username or password.' });
});

/** POST /api/logout */
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/** GET /api/me  — used by frontend to check login state on page load  */
app.get('/api/me', (req, res) => {
  resetIfNewDay();
  if (req.session?.user) {
    return res.json({
      loggedIn: true, username: req.session.user,
      apiUsed: apiUsage.count, apiLimit: DAILY_API_LIMIT, apiRemaining: getRemaining(),
    });
  }
  res.json({ loggedIn: false });
});

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

function cleanUrl(url) {
  if (!url) return null;
  if (!url.startsWith('http')) return 'https://' + url;
  return url;
}

function buildWhatsAppLink(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits.length) return null;
  const normalized = digits.length === 10 ? '1' + digits : digits;
  return `https://wa.me/${normalized}`;
}

function extractEmailsFromHtml(html, bag) {
  if (!html || typeof html !== 'string') return;
  const mailtoRe = /mailto:([^"'\s?>,<]+)/gi;
  let m;
  while ((m = mailtoRe.exec(html)) !== null) {
    const addr = m[1].split('?')[0].toLowerCase().trim();
    if (looksLikeRealEmail(addr)) bag.add(addr);
  }
  const emailRe = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  while ((m = emailRe.exec(html)) !== null) {
    const addr = m[1].toLowerCase();
    if (looksLikeRealEmail(addr)) bag.add(addr);
  }
}

function looksLikeRealEmail(addr) {
  const bad = ['.png', '.jpg', '.gif', '.svg', '.webp', '.css', '.js',
               'example.com', 'test.com', 'domain.com', 'email.com',
               'youremail', 'user@', 'name@', 'sentry', 'noreply', 'no-reply',
               'donotreply', 'mailer-daemon', 'postmaster'];
  if (!addr || !addr.includes('@')) return false;
  if (addr.length > 100) return false;
  return !bad.some(b => addr.includes(b));
}

async function scrapeEmailsFromWebsite(website) {
  const emails = new Set();
  const base   = cleanUrl(website);
  if (!base) return [...emails];

  const axiosOpts = {
    timeout: 7000, maxRedirects: 4,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    validateStatus: () => true,
  };

  let origin;
  try { origin = new URL(base).origin; } catch { origin = base; }

  const pages = [
    base,
    origin + '/contact', origin + '/contact-us', origin + '/contact.html',
    origin + '/about', origin + '/about-us', origin + '/team',
    origin + '/our-team', origin + '/reach-us', origin + '/info',
  ];

  for (const pageUrl of pages) {
    if (emails.size >= 3) break;
    try {
      const res = await axios.get(pageUrl, axiosOpts);
      if (typeof res.data === 'string') {
        const before = emails.size;
        extractEmailsFromHtml(res.data, emails);
        if (emails.size > before && emails.size >= 2) break;
      }
    } catch { /* continue */ }
  }
  return [...emails].slice(0, 5);
}

async function checkWebsiteQuality(url) {
  if (!url) return { score: 0, issues: ['No website'], hasWebsite: false };

  const issues = [];
  let score = 100;
  const start = Date.now();

  try {
    const cleanedUrl = cleanUrl(url);
    const response  = await axios.get(cleanedUrl, {
      timeout: 7000, maxRedirects: 4,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VixaBot/1.0)' },
      validateStatus: () => true,
    });

    const responseTime = Date.now() - start;
    const html         = response.data;
    const isHttps      = cleanedUrl.startsWith('https://');

    if (!isHttps)           { score -= 30; issues.push('No HTTPS'); }
    if (responseTime > 3000){ score -= 10; issues.push('Slow (' + Math.round(responseTime/1000) + 's)'); }

    if (typeof html === 'string') {
      const $ = cheerio.load(html);
      const metaDesc = $('meta[name="description"]').attr('content');
      if (!metaDesc || metaDesc.trim().length < 10) { score -= 20; issues.push('No meta description'); }
      const viewport  = $('meta[name="viewport"]').attr('content');
      if (!viewport)  { score -= 25; issues.push('Not mobile-friendly'); }
      const title     = $('title').text();
      if (!title || title.trim().length < 3) { score -= 15; issues.push('Missing title tag'); }
      if ($('h1').length === 0) { score -= 10; issues.push('No H1 heading'); }
    } else {
      score -= 20; issues.push('Non-HTML content');
    }

    score = Math.max(0, score);
    return {
      hasWebsite: true, score, issues, responseTime, isHttps,
      quality: score >= 70 ? 'good' : score >= 40 ? 'low' : 'very_low',
    };
  } catch {
    return { hasWebsite: true, score: 0, issues: ['Website unreachable'], quality: 'very_low' };
  }
}

// ═══════════════════════════════════════════════════════
//  SEARCH ENDPOINT  (SSE streaming) — PROTECTED
// ═══════════════════════════════════════════════════════
app.get('/api/search', requireAuth, async (req, res) => {
  const { location, businessType, maxResults } = req.query;
  if (!location || !businessType)
    return res.status(400).json({ error: 'location and businessType are required' });

  // Check daily limit before starting
  if (!canCall(1)) {
    return res.status(429).json({
      error: `Daily API limit reached (${DAILY_API_LIMIT} calls/day). Resets at midnight. Come back tomorrow!`,
      limitReached: true,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  try {
    const query = `${businessType} in ${location}`;
    send('status', { message: `Searching Google Maps for "${query}"...`, progress: 5 });

    const fieldMask = [
      'places.displayName', 'places.formattedAddress', 'places.websiteUri',
      'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
      'places.rating', 'places.userRatingCount', 'places.googleMapsUri',
      'places.businessStatus', 'places.types', 'places.id', 'places.primaryTypeDisplayName',
    ].join(',');

    // ── Fetch up to 3 pages ───────────────────────────────────────────────
    let allPlaces = [];
    let pageToken = null;
    let pageCount = 0;

    while (pageCount < 3) {
      // Check limit before each text-search page call
      if (!canCall(1)) {
        send('status', { message: `⚠️ Daily API limit hit (${DAILY_API_LIMIT}/day). Showing results so far...`, progress: 30 });
        break;
      }

      const body = { textQuery: query, maxResultCount: 20, languageCode: 'en' };
      if (pageToken) body.pageToken = pageToken;

      const apiRes = await axios.post(PLACES_API_URL, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': fieldMask,
        },
      });

      markCalls(1); // count this text-search page

      const places = apiRes.data.places || [];
      allPlaces    = allPlaces.concat(places);
      pageToken    = apiRes.data.nextPageToken;
      pageCount++;

      send('status', {
        message: `Found ${allPlaces.length} businesses... (${getRemaining()} API calls left today)`,
        progress: 10 + pageCount * 8,
        apiRemaining: getRemaining(),
      });
      if (!pageToken) break;
      await new Promise(r => setTimeout(r, 500));
    }

    const limit     = parseInt(maxResults) || allPlaces.length;
    const toProcess = allPlaces.slice(0, limit);

    send('status', {
      message: `Analyzing ${toProcess.length} businesses — checking websites & finding emails...`,
      progress: 35, total: toProcess.length,
    });

    let processed = 0;

    for (const place of toProcess) {
      const name    = place.displayName?.text || 'Unknown';
      const website = place.websiteUri || null;
      const phone   = place.nationalPhoneNumber || place.internationalPhoneNumber || null;

      send('status', {
        message: `🔍 Researching: ${name} (${getRemaining()} API calls left today)`,
        progress: 35 + Math.round((processed / toProcess.length) * 60),
        apiRemaining: getRemaining(),
      });

      // Run quality check + email scraping concurrently (no extra Google API calls)
      const [websiteData, emails] = await Promise.all([
        website
          ? checkWebsiteQuality(website)
          : Promise.resolve({ hasWebsite: false, score: 0, issues: ['No website'], quality: 'none' }),
        scrapeEmailsFromWebsite(website),
      ]);

      const whatsappLink = buildWhatsAppLink(phone);

      const result = {
        id: place.id, name,
        address:        place.formattedAddress || 'N/A',
        phone,          whatsappLink, emails,
        rating:         place.rating || null,
        ratingCount:    place.userRatingCount || 0,
        website:        website || null,
        googleMapsUrl:  place.googleMapsUri || null,
        businessStatus: place.businessStatus || 'OPERATIONAL',
        types:          place.types || [],
        category:       place.primaryTypeDisplayName?.text || businessType,
        websiteScore:   websiteData.score   || 0,
        websiteIssues:  websiteData.issues  || [],
        websiteQuality: websiteData.quality || 'none',
        hasWebsite:     websiteData.hasWebsite,
        isHttps:        websiteData.isHttps || false,
        responseTime:   websiteData.responseTime || null,
        leadPriority: !websiteData.hasWebsite
          ? 'high'
          : (websiteData.quality === 'very_low' || websiteData.quality === 'low')
            ? 'medium'
            : 'low',
      };

      send('result', { place: result });
      processed++;
    }

    send('complete', {
      message: 'Search complete!', progress: 100, total: processed,
      apiUsed: apiUsage.count, apiRemaining: getRemaining(), apiLimit: DAILY_API_LIMIT,
    });
  } catch (err) {
    console.error('Search error:', err.message);
    if (err.response) console.error('API Error:', JSON.stringify(err.response.data, null, 2));
    send('error', { message: err.response?.data?.error?.message || err.message || 'Search failed' });
  } finally {
    res.end();
  }
});

// ═══════════════════════════════════════════════════════
//  ON-DEMAND ENRICH ENDPOINT (email re-scrape) — PROTECTED
// ═══════════════════════════════════════════════════════
app.get('/api/enrich', requireAuth, async (req, res) => {
  const { website, phone } = req.query;
  try {
    const emails       = await scrapeEmailsFromWebsite(website || null);
    const whatsappLink = buildWhatsAppLink(phone || null);
    res.json({ emails, whatsappLink, apiRemaining: getRemaining() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🚀 Vixa Lead Finder running at http://localhost:${PORT}`);
  console.log(`🔒 Login required — ${Object.keys(USERS).length} users configured`);
  console.log(`📊 Daily API limit: ${DAILY_API_LIMIT} calls/day | Used today: ${apiUsage.count}`);
  console.log(`📌 Open your browser: http://localhost:${PORT}\n`);
});
