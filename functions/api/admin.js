// Jackson Investments Group — owner dashboard API + Reddit checker
// Routes (all need header x-admin-key):
//   GET  /api/admin/state            everything the dashboard shows
//   POST /api/admin/save             { key: "messages"|"settings"|"reddit", value }
//   POST /api/admin/alert            { id, handled: true|false }
//   POST /api/admin/reddit-check     run the Reddit check now
//   GET  /api/admin/zoom             upcoming Zoom Scheduler bookings + attendees
// Cron (wrangler.jsonc "triggers") runs the Reddit check automatically.

export const ADMIN_DEFAULTS = {
  ADMIN_PASSWORD: "JIG-owner-2026",
  SLACK_WEBHOOK_URL: "",   // Slack incoming webhook for alerts (optional)
  ZOOM_ACCOUNT_ID: "",
  ZOOM_CLIENT_ID: "",
  ZOOM_CLIENT_SECRET: "",
  REDDIT_UA: "web:jig-dashboard:1.0"
};

const DEFAULT_KEYWORDS = ["interested", "info", "dm", "pm", "message me", "apply", "how do i", "how can i", "sign me up", "details", "still hiring", "hiring?", "i'm in", "im in", "count me in", "tell me more", "more info", "link", "join", "commission", "how much"];

export const DEFAULT_MESSAGES = [
  { id: "indeed", label: "Indeed", text: "Remote Real Estate Acquisitions Rep – Commission Only (1099)\n\nJackson Investments Group buys houses in Phoenix, Houston, Dallas–Fort Worth, and Cleveland, and we're building a remote acquisitions team.\n\nWhat you'll do: Call homeowners from the leads we provide, find out what they need, and get them to accept an offer using our script and deal analyzer.\n\nPay: 30% of the assignment fee on every deal from our leads, 50% on deals you source yourself. Paid at closing. No cap. 100% commission, 1099 independent contractor, no base pay.\n\nYou get: 500 new leads every week, a proven script, an AI deal analyzer, training, and a team Slack.\n\nYou need: Fluent English, a computer, headset, reliable internet, and availability during US daytime hours. Phone sales experience is a plus, not required.\n\nApply: [link]" },
  { id: "linkedin", label: "LinkedIn", text: "We're hiring remote acquisitions reps at Jackson Investments Group.\n\nYou call motivated homeowners in Phoenix, Houston, Dallas–Fort Worth, and Cleveland and get them to accept an offer. We provide 500 leads a week, the script, the deal analyzer, and training.\n\nPay: 30% of the assignment fee on our leads, 50% on leads you source. Paid at closing, no cap. 100% commission, 1099, work from anywhere with US daytime availability.\n\nApply: [link]" },
  { id: "reddit", label: "Reddit r/forhire", text: "Title: [Hiring] Remote Real Estate Acquisitions Rep | Anywhere | 30–50% of assignment fee per deal (1099)\n\nCommission-only, independent contractor. We supply 500 homeowner leads a week in AZ, TX, and OH, plus a script, a deal analyzer, and training. You call, qualify, and get sellers to accept an offer. We handle contracts, buyers, and closing.\n\nPay: 30% of the assignment fee on our leads, 50% on leads you find yourself. Paid at closing, no cap, no base pay.\n\nNeed: fluent English, a headset, US daytime availability.\n\nComment or DM \"interested\" and I'll send details." },
  { id: "facebook", label: "Facebook group", text: "Looking for phone closers 📞\n\nWe hand you 500 leads a week, you get homeowners to accept an offer, and you keep 30% of every assignment fee (50% on deals you find yourself). No cap. Fully remote, set your own hours.\n\nWe handle the contracts, the buyers, and closing. You just dial.\n\nComment \"INFO\" or DM me to get on the next onboarding call." },
  { id: "craigslist", label: "Craigslist", text: "Remote Phone Sales – Real Estate Acquisitions (Commission Only)\n\nWe buy houses from motivated sellers and need reps to call homeowners and get offers accepted. Leads, script, and training provided.\n\nPay: 30% of the assignment fee per deal from our leads, 50% on your own. Paid at closing. 1099 contractor, no base pay.\n\nRemote, flexible hours (US daytime). Reply with your name and phone sales experience." },
  { id: "dm-reply", label: "DM reply to interested", text: "Hey [name], thanks for reaching out! Here's the quick version: you call homeowners who want to sell, get them to accept an offer using our script and deal analyzer, and we handle everything after that. You earn 30% of the assignment fee on our leads and 50% on leads you find yourself, paid at closing.\n\nWe walk through everything on a live onboarding call. Book a spot here: [booking link]" },
  { id: "post-call-text", label: "After-call text instructions", text: "Thanks for joining the Jackson Investments Group onboarding call! Next step: text [your number] with:\n1. Your full name\n2. How many hours per week you can work\n3. Any sales or real estate experience (and what kind)\n4. Where you're based + your time zone\n\nOur team will review and send your Slack invite." },
  { id: "slack-welcome", label: "Slack welcome DM", text: "Welcome to Jackson Investments Group! 👋 Start in #onboarding and read the full welcome message. Then grab the script in #call-scripts, watch the Zillow tutorial in #how-to-find-your-own-leads, and complete your 100-dial test task. Post your results in #onboarding and we'll get you into your market channel." }
];

const DEFAULT_SETTINGS = {
  booking_link: "",
  session_times: "Tue 6:00 PM AZ\nThu 6:00 PM AZ",
  text_number: "",
  links: [
    { label: "Slack", url: "https://app.slack.com" },
    { label: "Zoom", url: "https://zoom.us/meeting" },
    { label: "Miro", url: "https://miro.com/app/dashboard/" },
    { label: "GitHub repo", url: "https://github.com" },
    { label: "Cloudflare", url: "https://dash.cloudflare.com" }
  ],
  notes: ""
};

const DEFAULT_REDDIT = {
  inbox_feeds: [],        // private inbox RSS URLs from reddit.com/prefs/feeds (your own accounts)
  watch_users: [],        // other Reddit usernames whose posts + comments to watch
  watch_posts: [],        // specific post URLs to watch for comments
  keywords: DEFAULT_KEYWORDS,
  alert_all: false        // false = only keyword matches go to Slack
};

/* ---------- entry points ---------- */

export async function handleAdmin(request, rawEnv) {
  const env = withDefaults(rawEnv);
  const url = new URL(request.url);
  if (request.headers.get("x-admin-key") !== env.ADMIN_PASSWORD) return json({ error: "Wrong owner password." }, 401);
  if (!env.DB) return json({ error: "Storage isn't connected yet. Add the KV namespace to wrangler.jsonc (see setup steps)." }, 500);
  const path = url.pathname.replace("/api/admin", "") || "/";
  try {
    if (path === "/state" && request.method === "GET") {
      const [messages, settings, reddit, alerts, lastRun] = await Promise.all([
        getKV(env, "messages", DEFAULT_MESSAGES), getKV(env, "settings", DEFAULT_SETTINGS),
        getKV(env, "reddit", DEFAULT_REDDIT), getKV(env, "alerts", []), getKV(env, "reddit_last_run", null)
      ]);
      return json({ messages, settings, reddit, alerts, reddit_last_run: lastRun, zoom_configured: !!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET), slack_configured: !!env.SLACK_WEBHOOK_URL });
    }
    if (path === "/save" && request.method === "POST") {
      const { key, value } = await request.json();
      if (!["messages", "settings", "reddit"].includes(key)) return json({ error: "Unknown key" }, 400);
      await env.DB.put(key, JSON.stringify(value));
      return json({ ok: true });
    }
    if (path === "/alert" && request.method === "POST") {
      const { id, handled, all } = await request.json();
      const alerts = await getKV(env, "alerts", []);
      alerts.forEach(a => { if (all || a.id === id) a.handled = !!handled; });
      await env.DB.put("alerts", JSON.stringify(alerts));
      return json({ ok: true });
    }
    if (path === "/reddit-check" && request.method === "POST") {
      const result = await runRedditCheck(env);
      return json(result);
    }
    if (path === "/zoom" && request.method === "GET") {
      return json(await zoomData(env));
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

export async function scheduledReddit(rawEnv) {
  const env = withDefaults(rawEnv);
  if (!env.DB) return;
  await runRedditCheck(env);
}

/* ---------- Reddit (official RSS feeds, no API approval needed) ---------- */

async function runRedditCheck(env) {
  const cfg = { ...DEFAULT_REDDIT, ...(await getKV(env, "reddit", DEFAULT_REDDIT)) };
  const seenArr = await getKV(env, "reddit_seen", []);
  const seen = new Set(seenArr);
  const firstRun = seenArr.length === 0;
  const kw = (cfg.keywords && cfg.keywords.length ? cfg.keywords : DEFAULT_KEYWORDS).map(k => k.toLowerCase().trim()).filter(Boolean);
  let budget = 40; // stays well under Cloudflare's per-run request limit
  const errors = [];
  const found = [];

  const take = async (feedUrl, source) => {
    if (budget <= 0) return [];
    budget--;
    const entries = await fetchFeed(feedUrl, env).catch(e => { errors.push(`${source}: ${e.message}`); return []; });
    return entries;
  };
  const consider = (e, source, kind) => {
    if (!e.id || seen.has(e.id)) return;
    seen.add(e.id);
    const text = (e.title + " " + e.text).toLowerCase();
    const matched = kw.filter(k => matchesKeyword(text, k));
    found.push({ id: e.id, source, kind, author: e.author, title: e.title, text: e.text.slice(0, 600), link: e.link, at: e.updated || new Date().toISOString(), matched, interested: matched.length > 0, handled: false, found_at: new Date().toISOString() });
  };

  // 1) Your own accounts: private inbox feeds (comment replies, post replies, DMs)
  for (const f of cfg.inbox_feeds || []) {
    const url = String(f.url || f).trim(); if (!url) continue;
    const label = f.label || "Inbox";
    for (const e of await take(url, label)) consider(e, label, "inbox");
  }
  // 2) Other accounts: their recent posts, then comments on each post
  for (const u of cfg.watch_users || []) {
    const user = String(u).replace(/^\/?u\//i, "").trim(); if (!user) continue;
    const posts = await take(`https://www.reddit.com/user/${encodeURIComponent(user)}/submitted/.rss?limit=10`, `u/${user}`);
    const recent = posts.filter(p => !p.updated || Date.now() - Date.parse(p.updated) < 21 * 864e5).slice(0, 6);
    for (const p of recent) {
      const cUrl = commentsFeedFor(p.link); if (!cUrl) continue;
      for (const c of await take(cUrl, `u/${user} post`)) if (isCommentLink(c.link)) consider({ ...c, title: c.title || p.title }, `u/${user}`, "comment");
    }
  }
  // 3) Specific posts
  for (const pu of cfg.watch_posts || []) {
    const cUrl = commentsFeedFor(String(pu).trim()); if (!cUrl) continue;
    const entries = await take(cUrl, "Watched post");
    entries.forEach(c => { if (isCommentLink(c.link)) consider(c, "Watched post", "comment"); });
  }

  // First run only records what already exists so you don't get flooded with old comments.
  let newAlerts = [];
  if (!firstRun) newAlerts = found;
  const alerts = await getKV(env, "alerts", []);
  const merged = [...newAlerts.reverse(), ...alerts].slice(0, 400);
  await Promise.all([
    env.DB.put("alerts", JSON.stringify(merged)),
    env.DB.put("reddit_seen", JSON.stringify([...seen].slice(-4000))),
    env.DB.put("reddit_last_run", JSON.stringify({ at: new Date().toISOString(), new_items: newAlerts.length, interested: newAlerts.filter(a => a.interested).length, errors: errors.slice(0, 5), first_run: firstRun }))
  ]);

  const toSlack = newAlerts.filter(a => cfg.alert_all || a.interested);
  if (env.SLACK_WEBHOOK_URL && toSlack.length) {
    for (const a of toSlack.slice(0, 10)) {
      await fetch(env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        text: `:rotating_light: *${a.interested ? "Interested" : "New"} reply on Reddit* (${a.source})\n*${a.author || "someone"}:* ${a.text.slice(0, 300)}\n<${a.link}|Open on Reddit>${a.matched.length ? `  ·  matched: ${a.matched.join(", ")}` : ""}`
      }) }).catch(() => {});
    }
  }
  return { ok: true, first_run: firstRun, new_items: newAlerts.length, interested: newAlerts.filter(a => a.interested).length, errors };
}

function matchesKeyword(text, k) {
  if (k.length <= 3) return new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text);
  return text.includes(k);
}

// A comment link has an extra id after the post slug: /comments/<post>/<slug>/<comment>/
function isCommentLink(link) {
  const m = String(link || "").match(/\/comments\/[a-z0-9]+\/[^/]*\/([a-z0-9]+)\/?/i);
  return !!m;
}

function commentsFeedFor(link) {
  const m = String(link || "").match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i) || String(link || "").match(/reddit\.com\/(?:u|user)\/([^/]+)\/comments\/([a-z0-9]+)/i);
  if (!m) return null;
  return `https://www.reddit.com/comments/${m[2]}/.rss?sort=new&limit=50`;
}

async function fetchFeed(url, env) {
  const r = await fetch(url, { headers: { "user-agent": env.REDDIT_UA, accept: "application/atom+xml, application/rss+xml, text/xml" } });
  if (!r.ok) throw new Error(`Reddit returned ${r.status}${r.status === 403 || r.status === 429 ? " (blocked or rate-limited; will retry next run)" : ""}`);
  return parseAtom(await r.text());
}

function parseAtom(xml) {
  const out = [];
  const entries = xml.split(/<entry[\s>]/).slice(1);
  for (const raw of entries) {
    const block = raw.split("</entry>")[0];
    const get = tag => { const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? m[1] : ""; };
    const linkM = block.match(/<link[^>]*href="([^"]+)"/);
    const authorName = (block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/) || [])[1] || "";
    out.push({
      id: decode(get("id")).trim(),
      title: decode(get("title")).trim(),
      text: stripHtml(decode(get("content"))).trim(),
      link: linkM ? decode(linkM[1]) : "",
      author: decode(authorName).trim(),
      updated: get("updated").trim() || get("published").trim()
    });
  }
  return out;
}
function decode(s) { return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, "&"); }
function stripHtml(s) { return String(s || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\[link\]|\[comments\]|submitted by/g, " ").replace(/\s+/g, " "); }

/* ---------- Zoom Scheduler ---------- */

let zoomToken = null, zoomTokenExp = 0;
async function zoomAuth(env) {
  if (zoomToken && Date.now() < zoomTokenExp) return zoomToken;
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_ACCOUNT_ID)}`, {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Zoom sign-in failed (${r.status}): ${j.reason || j.error || "check your Zoom app credentials"}`);
  zoomToken = j.access_token; zoomTokenExp = Date.now() + ((j.expires_in || 3600) - 120) * 1000;
  return zoomToken;
}
async function zoomGet(env, path) {
  const t = await zoomAuth(env);
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${path.split("?")[0]} → ${r.status}: ${j.message || "error"}`); e.status = r.status; throw e; }
  return j;
}
async function zoomData(env) {
  if (!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET)) return { configured: false };
  const out = { configured: true, schedules: [], events: [], meetings: [], errors: [] };
  const now = new Date(), later = new Date(Date.now() + 45 * 864e5);
  // Booking pages
  try {
    const s = await zoomGet(env, "/scheduler/schedules?page_size=50");
    out.schedules = (s.items || s.schedules || []).map(x => ({ id: x.schedule_id || x.id, name: x.summary || x.name || x.title || "Schedule", link: x.scheduling_url || x.booking_url || x.url || x.link || null, duration: x.duration || null, active: x.active ?? x.status ?? null }));
  } catch (e) { out.errors.push(e.message); }
  // Bookings with attendees
  const tries = [
    `/scheduler/events?from=${now.toISOString()}&to=${later.toISOString()}&page_size=100`,
    `/scheduler/events?page_size=100`
  ];
  for (const t of tries) {
    try {
      const ev = await zoomGet(env, t);
      const items = ev.items || ev.events || ev.scheduled_events || [];
      out.events = items.map(x => {
        const start = x.start_date_time || x.start_time || x.start || (x.start_date && x.start_date.date_time) || null;
        return {
          id: x.event_id || x.id, title: x.summary || x.title || x.name || "Booking", start,
          end: x.end_date_time || x.end_time || null, status: x.status || null,
          join_url: (x.external_location && (x.external_location.meeting_join_url || x.external_location.join_url)) || x.join_url || x.location || null,
          attendees: (x.attendees || x.invitees || []).map(a => ({ name: a.display_name || a.name || [a.first_name, a.last_name].filter(Boolean).join(" ") || null, email: a.email || null, status: a.status || a.response_status || null }))
        };
      }).filter(x => !x.start || Date.parse(x.start) > Date.now() - 3 * 3600e3).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      break;
    } catch (e) { if (t === tries[tries.length - 1]) out.errors.push(e.message); }
  }
  // Upcoming Zoom meetings (session times) as a backup view
  try {
    const m = await zoomGet(env, "/users/me/meetings?type=upcoming&page_size=30");
    out.meetings = (m.meetings || []).map(x => ({ id: x.id, topic: x.topic, start: x.start_time, join_url: x.join_url, duration: x.duration }));
  } catch (e) { out.errors.push(e.message); }
  return out;
}

/* ---------- helpers ---------- */
function withDefaults(rawEnv) {
  return { ...ADMIN_DEFAULTS, ...Object.fromEntries(Object.entries(rawEnv || {}).filter(([, v]) => v)) };
}
async function getKV(env, key, fallback) {
  try { const v = await env.DB.get(key, "json"); return v ?? fallback; } catch { return fallback; }
}
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
