// worker/account-results.js
var fields = ["id", "title", "kind", "date", "updated_at", "answer", "text", "partial", "failures"];
function validAccountResult(row) {
  return row && Object.keys(row).every((k) => fields.includes(k)) && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 500 && typeof row.title === "string" && row.title.length <= 1e3 && ["news", "text", "podcast"].includes(row.kind) && typeof row.updated_at === "string" && /^\d{4}-\d\d-\d\dT/.test(row.updated_at) && Number.isFinite(Date.parse(row.updated_at)) && typeof row.answer === "string" && typeof row.text === "string" && typeof row.date === "string" && typeof row.partial === "boolean" && Array.isArray(row.failures) && row.failures.every((v) => typeof v === "string");
}
async function accountResultsRoute(req, { sql, reply, user }) {
  const url = new URL(req.url);
  if (!["/account-results", "/account-news"].includes(url.pathname)) return null;
  if (url.pathname === "/account-news") {
    await sql("CREATE TABLE IF NOT EXISTS account_news(user_id TEXT NOT NULL,url TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(user_id,url))").run();
    if (req.method === "GET") return reply({ news: (await sql("SELECT payload FROM account_news WHERE user_id=? LIMIT 2000", user.id).all()).results.map((r) => JSON.parse(r.payload)) });
    if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    const raw2 = await req.text();
    if (new TextEncoder().encode(raw2).length > 5e5) return reply({ error: "\u65B0\u805E\u540C\u6B65\u8CC7\u6599\u904E\u5927" }, 413);
    let rows;
    try {
      rows = JSON.parse(raw2);
    } catch {
      return reply({ error: "Invalid JSON" }, 400);
    }
    const keys = ["company_code", "title", "url", "source", "published_at", "news_date"];
    if (!Array.isArray(rows) || rows.length > 100 || rows.some((r) => !r || Object.keys(r).some((k) => !keys.includes(k)) || keys.some((k) => typeof r[k] !== "string") || !/^https?:\/\//.test(r.url) || !/^\d{4,6}$/.test(r.company_code))) return reply({ error: "Invalid news" }, 400);
    for (const row2 of rows) await sql("INSERT INTO account_news(user_id,url,payload) VALUES(?,?,?) ON CONFLICT(user_id,url) DO UPDATE SET payload=excluded.payload", user.id, row2.url, JSON.stringify(row2)).run();
    return reply({ ok: true });
  }
  if (!["GET", "POST", "DELETE"].includes(req.method)) return reply({ error: "Method not allowed" }, 405);
  await sql("CREATE TABLE IF NOT EXISTS account_results(user_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,id))").run();
  if (req.method === "GET") {
    const rows = (await sql("SELECT id,payload,updated_at FROM account_results WHERE user_id=? ORDER BY updated_at DESC LIMIT 200", user.id).all()).results;
    return reply({ results: rows.filter((r) => !JSON.parse(r.payload).deleted).map((r) => JSON.parse(r.payload)), deleted: rows.filter((r) => JSON.parse(r.payload).deleted).map((r) => ({ id: r.id, updated_at: r.updated_at })) });
  }
  if (req.method === "DELETE") {
    await sql("INSERT INTO account_results(user_id,id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at", user.id, url.searchParams.get("id"), JSON.stringify({ deleted: true }), (/* @__PURE__ */ new Date()).toISOString()).run();
    return reply({ ok: true });
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > 5e5) return reply({ error: "\u6210\u679C\u8D85\u904E\u540C\u6B65\u5927\u5C0F\u4E0A\u9650\uFF0C\u5DF2\u4FDD\u7559\u65BC\u6B64\u88DD\u7F6E" }, 413);
  let row;
  try {
    row = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (!validAccountResult(row)) return reply({ error: "\u50C5\u63A5\u53D7\u5B8C\u6210\u6210\u679C\uFF0C\u4E0D\u53EF\u5305\u542B AI \u8A2D\u5B9A\u6216\u91D1\u9470" }, 400);
  await sql("INSERT INTO account_results(user_id,id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE excluded.updated_at>account_results.updated_at", user.id, row.id, raw, row.updated_at).run();
  return reply({ ok: true });
}

// worker/podcasts.js
var fields2 = ["id", "title", "published_at", "date", "url", "audio_url", "description", "duration", "transcript_url"];
function podcastFeed(value) {
  const u = new URL(String(value || "").trim());
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port || !h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)) throw Error("\u8ACB\u4F7F\u7528\u516C\u958B HTTPS Podcast RSS \u7DB2\u5740");
  return u.href;
}
function payload(data, id, feed) {
  if (!data || typeof data.title !== "string" || !data.title.trim() || data.title.length > 500 || !Array.isArray(data.episodes) || !data.episodes.length || data.episodes.length > 150) throw Error("Podcast \u96C6\u6578\u8CC7\u6599\u683C\u5F0F\u932F\u8AA4");
  const episodes = data.episodes.map((e) => {
    if (!e.id || !e.title || !Number.isFinite(Date.parse(e.published_at))) throw Error("Podcast \u96C6\u6578\u8CC7\u6599\u683C\u5F0F\u932F\u8AA4");
    const row = Object.fromEntries(fields2.map((k) => [k, String(e[k] || "").slice(0, k === "description" ? 1e4 : 2e3)]));
    for (const k of ["url", "audio_url", "transcript_url"]) if (row[k]) {
      const u = new URL(row[k]);
      if (u.protocol !== "https:" || u.username || u.password) throw Error("Podcast \u9023\u7D50\u5FC5\u9808\u662F HTTPS");
    }
    return row;
  });
  const result = { id, feed, title: data.title.trim(), spotify: "", updated_at: (/* @__PURE__ */ new Date()).toISOString(), episodes };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 15e5) throw Error("Podcast \u8CC7\u6599\u8D85\u51FA\u5927\u5C0F\u4E0A\u9650");
  return result;
}
async function resolveSpotifyPodcast(value, fetcher = globalThis.fetch) {
  const u = new URL(String(value || ""));
  if (u.protocol !== "https:" || u.hostname !== "open.spotify.com" || u.username || u.password || u.port || !/^\/(?:intl-[a-z]+\/)?show\/[A-Za-z0-9]{22}\/?$/.test(u.pathname)) throw Error("\u8ACB\u8CBC\u4E0A Spotify \u7BC0\u76EE\u9023\u7D50\uFF08show\uFF09\uFF0C\u4E0D\u662F\u55AE\u96C6\u9023\u7D50\u3002");
  const show = u.pathname.split("/").filter(Boolean).at(-1), url = "https://open.spotify.com/show/" + show;
  if (show === "6SjGs5mgZ4IAo82tHygxD2") return { title: "\u5C0F\u670B\u53CB\u5B78\u6295\u8CC7", candidates: [{ title: "\u5C0F\u670B\u53CB\u5B78\u6295\u8CC7", author: "\u5C0F\u670B\u53CB\u5718\u968A", feed: "https://feed.firstory.me/rss/user/ckgt1mz641n230804jvx96k4m" }] };
  const read = async (endpoint) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetcher(endpoint, { redirect: "manual", signal: AbortSignal.timeout(1e4), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
      if (r.status >= 300 && r.status < 400) {
        const next = new URL(r.headers.get("Location") || "", endpoint);
        if (next.protocol !== "https:" || next.hostname !== "itunes.apple.com" || next.username || next.password || next.port) throw Error("\u641C\u5C0B\u4F86\u6E90\u8F49\u5740\u4E0D\u53D7\u652F\u63F4\u3002");
        endpoint = next.href;
        continue;
      }
      if (!r.ok) throw Error("Podcast \u76EE\u9304\u641C\u5C0B\u5931\u6557\uFF08HTTP " + r.status + "\uFF09\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66\u3002");
      return r.json();
    }
    throw Error("Podcast \u76EE\u9304\u8F49\u5740\u6B21\u6578\u904E\u591A\u3002");
  };
  const page = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(1e4), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
  if (!page.ok) throw Error("Spotify \u7BC0\u76EE\u9801\u66AB\u6642\u7121\u6CD5\u8B80\u53D6\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66\u3002");
  const html = await page.text();
  const decode = (v) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  const title = decode(html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] || "").trim();
  if (!title || title.length > 500) throw Error("\u7121\u6CD5\u53D6\u5F97 Spotify \u7BC0\u76EE\u540D\u7A31\u3002");
  const results = await read("https://itunes.apple.com/search?media=podcast&entity=podcast&country=TW&limit=25&term=" + encodeURIComponent(title));
  const normalize = (v) => String(v || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const target = normalize(title), seen = /* @__PURE__ */ new Set(), candidates = [];
  for (const row of results.results || []) {
    const name = String(row.collectionName || row.trackName || ""), n = normalize(name);
    if (!n || !(n === target || n.includes(target) || target.includes(n))) continue;
    let feed;
    try {
      feed = podcastFeed(row.feedUrl);
    } catch {
      continue;
    }
    if (seen.has(feed)) continue;
    seen.add(feed);
    candidates.push({ title: name, author: String(row.artistName || ""), feed });
  }
  return { title, candidates: candidates.slice(0, 10) };
}
async function sharedPodcastsRoute(req, { sql, reply, user, admin = false, hash: hash2 }) {
  const u = new URL(req.url), path = u.pathname;
  if (!["/podcasts/channels", "/podcasts/episodes", "/admin/podcasts/channels", "/admin/podcasts/update", "/podcasts/resolve"].includes(path)) return null;
  if (!admin && !user) return reply({ error: "\u8ACB\u5148\u767B\u5165" }, 401);
  if (path === "/podcasts/resolve") {
    if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    try {
      return reply(await resolveSpotifyPodcast((await req.json()).url));
    } catch (e) {
      return reply({ error: e.message }, 400);
    }
  }
  await sql("CREATE TABLE IF NOT EXISTS podcast_channels(id TEXT PRIMARY KEY,feed TEXT NOT NULL UNIQUE,title TEXT NOT NULL,payload TEXT NOT NULL,created_by TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT)").run();
  if ((path === "/podcasts/channels" || path === "/admin/podcasts/channels") && req.method === "GET") return reply({ channels: (await sql("SELECT id,feed,title,updated_at,last_error FROM podcast_channels ORDER BY title LIMIT 100").all()).results });
  if (path === "/podcasts/episodes" && req.method === "GET") {
    const row = await sql("SELECT payload,last_error FROM podcast_channels WHERE id=?", u.searchParams.get("id")).first();
    return row ? reply({ ...JSON.parse(row.payload), error: row.last_error || "" }) : reply({ error: "\u627E\u4E0D\u5230\u983B\u9053" }, 404);
  }
  if (path === "/podcasts/episodes" && req.method === "POST") {
    const row = await sql("SELECT id,feed FROM podcast_channels WHERE id=?", u.searchParams.get("id")).first();
    if (!row) return reply({ error: "\u627E\u4E0D\u5230\u983B\u9053" }, 404);
    try {
      const data = await req.json();
      if (podcastFeed(data.feed) !== row.feed) throw Error("Feed mismatch");
      const saved = payload(data, row.id, row.feed);
      await sql("UPDATE podcast_channels SET title=?,payload=?,updated_at=?,last_error=NULL WHERE id=?", saved.title, JSON.stringify(saved), saved.updated_at, row.id).run();
      return reply(saved);
    } catch {
      return reply({ error: "Podcast \u66F4\u65B0\u8CC7\u6599\u683C\u5F0F\u932F\u8AA4" }, 400);
    }
  }
  if (path === "/podcasts/channels" && req.method === "POST") {
    try {
      const data = await req.json(), feed = podcastFeed(data.feed), id = "shared-" + (await hash2(feed)).slice(0, 24), existing = await sql("SELECT payload FROM podcast_channels WHERE feed=?", feed).first();
      if (existing) return reply({ channel: JSON.parse(existing.payload), existing: true });
      const count = await sql("SELECT COUNT(*) AS total FROM podcast_channels").first();
      if (count.total >= 100) return reply({ error: "\u5171\u7528\u983B\u9053\u5DF2\u9054 100 \u500B\u4E0A\u9650" }, 409);
      const saved = payload(data, id, feed);
      await sql("INSERT INTO podcast_channels(id,feed,title,payload,created_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(feed) DO NOTHING", id, feed, saved.title, JSON.stringify(saved), user.id, saved.updated_at).run();
      const row = await sql("SELECT payload FROM podcast_channels WHERE feed=?", feed).first();
      return reply({ channel: JSON.parse(row.payload) });
    } catch {
      return reply({ error: "\u532F\u5165\u5931\u6557\uFF1A\u8ACB\u78BA\u8A8D\u516C\u958B HTTPS RSS \u8207\u96C6\u6578\u5167\u5BB9" }, 400);
    }
  }
  if (path === "/admin/podcasts/update" && req.method === "POST") {
    const data = await req.json(), row = await sql("SELECT * FROM podcast_channels WHERE id=?", data.id).first();
    if (!row) return reply({ error: "\u627E\u4E0D\u5230\u983B\u9053" }, 404);
    if (data.error) {
      await sql("UPDATE podcast_channels SET last_error=? WHERE id=?", String(data.error).slice(0, 500), row.id).run();
      return reply({ ok: true });
    }
    try {
      const saved = payload(data, row.id, row.feed);
      await sql("UPDATE podcast_channels SET title=?,payload=?,updated_at=?,last_error=NULL WHERE id=?", saved.title, JSON.stringify(saved), saved.updated_at, row.id).run();
      return reply({ ok: true });
    } catch {
      return reply({ error: "Podcast \u96C6\u6578\u8CC7\u6599\u683C\u5F0F\u932F\u8AA4" }, 400);
    }
  }
  return reply({ error: "Method not allowed" }, 405);
}

// worker/ai-jobs.js
var enc = new TextEncoder();
var b64 = (bytes) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 16384) value += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(value);
};
async function encryptTask(value, secret, id) {
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("personal-ai-jobs-v1:" + secret)), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id) }, key, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), data: b64(new Uint8Array(bytes)) };
}
function cloudConfig(config) {
  if (!["openai", "azure"].includes(config?.provider) || config.transport === "python") throw Error("\u96F2\u7AEF\u80CC\u666F\u76EE\u524D\u53EA\u652F\u63F4\u516C\u958B OpenAI\uFF0FAzure \u7AEF\u9EDE\uFF1B\u516C\u53F8\u5167\u7DB2\u8ACB\u7528\u88DD\u7F6E\u6A21\u5F0F\u3002");
  const u = new URL(config.endpoint);
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash || (config.provider === "openai" ? u.hostname !== "api.openai.com" : !u.hostname.endsWith(".openai.azure.com"))) throw Error("\u4E0D\u652F\u63F4\u7684\u96F2\u7AEF AI \u7AEF\u9EDE\u3002");
  if (!config.key?.trim() || config.key.length > 1e3 || !config.model?.trim() || config.model.length > 200) throw Error("\u8ACB\u586B\u6709\u6548 API Key \u8207\u6A21\u578B\u3002");
  return { provider: config.provider, endpoint: u.href, model: config.model.trim(), key: config.key.trim(), version: String(config.version || "2024-10-21").slice(0, 40) };
}
var schema = "CREATE TABLE IF NOT EXISTS personal_ai_tasks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,date TEXT NOT NULL,status TEXT NOT NULL,progress TEXT NOT NULL,encrypted TEXT,output TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,read_at INTEGER,lease TEXT)";
var publicTask = (r) => ({ id: r.id, title: r.title, kind: r.kind, date: r.date, state: ["done", "partial"].includes(r.status) ? "complete" : ["failed", "interrupted"].includes(r.status) ? "interrupted" : r.status, progress: r.progress, updated_at: new Date(r.updated_at).toISOString(), read_at: r.read_at ? new Date(r.read_at).toISOString() : null, cloud_id: r.id, ...JSON.parse(r.output) });
async function aiJobsRoute(req, env, { user, admin = false, reply, dispatch: dispatch2, readArticleURL: readArticleURL2 }) {
  const path = new URL(req.url).pathname;
  if (!path.startsWith("/ai-jobs") && !path.startsWith("/admin/ai-jobs")) return null;
  const sql = (q, ...args) => env.DB.prepare(q).bind(...args);
  await sql(schema).run();
  const now = Date.now();
  await sql("UPDATE personal_ai_tasks SET status='interrupted',progress='\u8655\u7406\u7A0B\u5E8F\u4E2D\u65B7\uFF0C\u8ACB\u91CD\u65B0\u9001\u51FA\u4E26\u4FDD\u7559\u6210\u529F\u6BB5\u843D',encrypted=NULL,updated_at=?,lease=NULL WHERE status='running' AND updated_at<?", now, now - 20 * 6e4).run();
  await sql("UPDATE personal_ai_tasks SET status='interrupted',progress='\u4EFB\u52D9\u5DF2\u903E\u671F\uFF0C\u8ACB\u91CD\u65B0\u9001\u51FA',encrypted=NULL,updated_at=? WHERE encrypted IS NOT NULL AND expires_at<?", now, now).run();
  if (admin) {
    if (path === "/admin/ai-jobs/article") {
      const b = await req.json();
      try {
        return reply(await readArticleURL2(b.url));
      } catch (e) {
        return reply({ error: e.message }, 422);
      }
    }
    if (path === "/admin/ai-jobs/claim" && req.method === "POST") {
      const lease = crypto.randomUUID();
      const r = await sql("UPDATE personal_ai_tasks SET status='running',progress='\u80CC\u666F\u8655\u7406\u4E2D',lease=?,updated_at=? WHERE id IN (SELECT id FROM personal_ai_tasks WHERE status='queued' AND expires_at>? ORDER BY created_at LIMIT 1) RETURNING *", lease, now, now).first();
      return reply({ task: r ? { id: r.id, kind: r.kind, title: r.title, date: r.date, lease, encrypted: JSON.parse(r.encrypted), output: JSON.parse(r.output) } : null });
    }
    if (path === "/admin/ai-jobs/update" && req.method === "POST") {
      const b = await req.json();
      if (!["running", "done", "partial", "failed"].includes(b.status) || enc.encode(JSON.stringify(b.output || {})).length > 15e5) return reply({ error: "Invalid output" }, 400);
      const output = {};
      for (const field of ["answer", "text", "partial", "failures", "segments", "articles", "episode", "total", "request"]) if (b.output?.[field] !== void 0) output[field] = b.output[field];
      const changed = await sql("UPDATE personal_ai_tasks SET status=?,progress=?,output=?,encrypted=CASE WHEN ?='running' THEN encrypted ELSE NULL END,updated_at=?,read_at=NULL,lease=CASE WHEN ?='running' THEN lease ELSE NULL END WHERE id=? AND lease=? AND status='running' RETURNING id", b.status, String(b.progress || "").slice(0, 1e3), JSON.stringify(output), b.status, now, b.status, b.id, b.lease).first();
      return reply({ ok: !!changed });
    }
    return reply({ error: "Not found" }, 404);
  }
  if (path === "/ai-jobs/capabilities") return reply({ enabled: !!env.COLLECTOR_SECRET && !!env.GITHUB_DISPATCH_TOKEN, providers: ["openai", "azure"] });
  if (req.method === "GET") return reply({ tasks: (await sql("SELECT * FROM personal_ai_tasks WHERE user_id=? ORDER BY updated_at DESC LIMIT 100", user.id).all()).results.map(publicTask) });
  if (req.method === "DELETE") {
    await sql("DELETE FROM personal_ai_tasks WHERE id=? AND user_id=?", new URL(req.url).searchParams.get("id"), user.id).run();
    return reply({ ok: true });
  }
  if (path === "/ai-jobs/read" && req.method === "POST") {
    const b = await req.json();
    await sql("UPDATE personal_ai_tasks SET read_at=? WHERE id=? AND user_id=?", now, b.id, user.id).run();
    return reply({ ok: true });
  }
  if (path === "/ai-jobs" && req.method === "POST") {
    if (!env.COLLECTOR_SECRET || !env.GITHUB_DISPATCH_TOKEN) return reply({ error: "\u5F8C\u7AEF\u80CC\u666F\u4EFB\u52D9\u5C1A\u672A\u555F\u7528\u3002" }, 503);
    const b = await req.json();
    if (b.consent !== true) return reply({ error: "\u8ACB\u78BA\u8A8D\u672C\u6B21\u96F2\u7AEF\u80CC\u666F\u8655\u7406\u8207\u66AB\u5B58 Key \u8AAA\u660E\u3002" }, 400);
    if (!["news", "podcast"].includes(b.kind) || typeof b.title !== "string" || b.title.length > 500 || enc.encode(JSON.stringify(b.input || {})).length > 9e5) return reply({ error: "Invalid task" }, 400);
    let config;
    try {
      config = cloudConfig(b.config);
    } catch (e) {
      return reply({ error: e.message }, 400);
    }
    const count = await sql("SELECT COUNT(*) AS n FROM personal_ai_tasks WHERE user_id=? AND (status IN ('queued','running') OR created_at>?)", user.id, now - 864e5).first();
    if (count.n >= 30) return reply({ error: "\u6BCF\u65E5\u6700\u591A\u5EFA\u7ACB 30 \u500B\u80CC\u666F\u4EFB\u52D9\u3002" }, 429);
    const initial = b.kind === "podcast" ? { episode: Object.fromEntries(["id", "title", "date", "audio_url", "url", "channel_name", "description", "guests"].map((k) => [k, String(b.input?.episode?.[k] || "").slice(0, 2e3)])), text: typeof b.input?.text === "string" ? b.input.text : "", segments: Array.isArray(b.input?.segments) ? b.input.segments : [], partial: !!b.input?.partial } : { request: { rows: (Array.isArray(b.input?.rows) ? b.input.rows : []).map((r) => Object.fromEntries(["title", "url", "article_url", "news_date", "company_code", "source"].map((k) => [k, String(r[k] || "").slice(0, 2e3)]))), date: b.date, title: b.title } };
    const id = crypto.randomUUID(), encrypted = await encryptTask({ config, input: b.input }, env.COLLECTOR_SECRET, id);
    await sql("INSERT INTO personal_ai_tasks(id,user_id,kind,title,date,status,progress,encrypted,created_at,updated_at,expires_at,output) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, user.id, b.kind, b.title, String(b.date || "").slice(0, 10), "queued", "\u5DF2\u6392\u5165\u80CC\u666F\u4EFB\u52D9\uFF0C\u53EF\u95DC\u9589\u9801\u9762", JSON.stringify(encrypted), now, now, now + 864e5, JSON.stringify(initial)).run();
    let dispatched;
    try {
      dispatched = await dispatch2(env);
    } catch {
      await sql("UPDATE personal_ai_tasks SET status='failed',progress='\u7121\u6CD5\u555F\u52D5 GitHub Actions\uFF0C\u8ACB\u6AA2\u67E5\u5F8C\u7AEF\u8A2D\u5B9A',encrypted=NULL WHERE id=?", id).run();
      return reply({ error: "\u7121\u6CD5\u555F\u52D5\u80CC\u666F\u5DE5\u4F5C\uFF0C\u6C92\u6709\u7E7C\u7E8C\u4FDD\u5B58\u672C\u6B21 Key\u3002" }, 503);
    }
    return reply({ task: publicTask(await sql("SELECT * FROM personal_ai_tasks WHERE id=?", id).first()), dispatched }, 202);
  }
  return reply({ error: "Not found" }, 404);
}

// worker/summary-cache.js
async function summaryCacheRoute(req, { sql, reply, user, randomToken: randomToken2 }) {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const raw = await req.text();
  if (raw.length > 65e3) return reply({ error: "Too large" }, 413);
  let b;
  try {
    b = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (!b || Object.keys(b).some((k) => !["key", "action", "lease", "answer"].includes(k)) || !/^[a-f0-9]{64}$/.test(b.key) || !["claim", "save", "release"].includes(b.action)) return reply({ error: "Invalid cache request" }, 400);
  await sql("CREATE TABLE IF NOT EXISTS summary_cache(key TEXT PRIMARY KEY,answer TEXT,owner TEXT,lease TEXT,expires INTEGER NOT NULL)").run();
  const now = Date.now();
  if (b.action === "claim") {
    await sql("DELETE FROM summary_cache WHERE expires<?", now).run();
    const lease = randomToken2();
    await sql("INSERT INTO summary_cache(key,owner,lease,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET answer=NULL,owner=excluded.owner,lease=excluded.lease,expires=excluded.expires WHERE summary_cache.expires<?", b.key, user.id, lease, now + 10 * 6e4, now).run();
    const row2 = await sql("SELECT answer,lease FROM summary_cache WHERE key=?", b.key).first();
    return reply(row2.answer ? { answer: row2.answer, cached: true } : row2.lease === lease ? { lease } : { pending: true });
  }
  if (typeof b.lease !== "string") return reply({ error: "Missing lease" }, 400);
  if (b.action === "release") {
    await sql("DELETE FROM summary_cache WHERE key=? AND owner=? AND lease=? AND answer IS NULL", b.key, user.id, b.lease).run();
    return reply({ ok: true });
  }
  if (typeof b.answer !== "string" || !b.answer.trim() || b.answer.length > 6e4) return reply({ error: "Invalid summary" }, 400);
  const row = await sql("UPDATE summary_cache SET answer=?,owner=NULL,lease=NULL,expires=? WHERE key=? AND owner=? AND lease=? AND expires>? RETURNING key", b.answer, now + 30 * 864e5, b.key, user.id, b.lease, now).first();
  return row ? reply({ ok: true }) : reply({ error: "Cache lease expired" }, 409);
}

// worker/index.js
function dailyBars(result, code) {
  const quote = result.indicators?.quote?.[0], rows = [];
  for (const [i, t] of (result.timestamp || []).entries()) {
    const [open, high, low, close] = ["open", "high", "low", "close"].map((k) => quote?.[k]?.[i]);
    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0) || low > Math.min(open, close) || high < Math.max(open, close)) continue;
    rows.push({ code, date: new Date(t * 1e3 + 8 * 36e5).toISOString().slice(0, 10), open, high, low, close, volume: Number.isFinite(quote?.volume?.[i]) ? quote.volume[i] : null });
  }
  return rows;
}
async function fetchDailyBars(company) {
  const symbol = company.code + (company.market === "\u4E0A\u6AC3" ? ".TWO" : ".TW");
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${symbol}?interval=1d&range=2y&includePrePost=false`, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(7e3) });
      if (!r.ok) continue;
      const result = (await r.json()).chart?.result?.[0];
      if (result?.meta?.symbol !== symbol) continue;
      const rows2 = dailyBars(result, company.code);
      if (rows2.length) return { rows: rows2, source: "Yahoo Finance" };
    } catch {
    }
  }
  const now = new Date(Date.now() + 8 * 36e5), otc = company.market === "\u4E0A\u6AC3";
  const months = await Promise.all(Array.from({ length: 25 }, async (_, i) => {
    try {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)), month = d.toISOString().slice(0, 7), date = month.replace("-", "") + "01";
      const u = otc ? `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?response=json&date=${month.replace("-", "/")}/01&code=${company.code}` : `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${company.code}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(7e3) });
      if (!r.ok) return [];
      const data = await r.json(), records = otc ? data.tables?.[0]?.data : data.data;
      return (records || []).flatMap((row) => {
        const [y, m, day] = String(row[0]).split("/").map(Number), key = `${y + 1911}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const n = (v) => Number(String(v).replaceAll(",", ""));
        const [open, high, low, close] = row.slice(3, 7).map(n), volume = n(row[1]) * (otc ? 1e3 : 1);
        if (key.slice(0, 7) !== month || ![open, high, low, close].every((v) => Number.isFinite(v) && v > 0) || low > Math.min(open, close) || high < Math.max(open, close)) return [];
        return [{ code: company.code, date: key, open, high, low, close, volume: Number.isFinite(volume) ? volume : null }];
      });
    } catch {
      return [];
    }
  }));
  const rows = months.flat().sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length) return { rows, source: otc ? "\u6AC3\u8CB7\u4E2D\u5FC3" : "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240" };
  throw Error("\u884C\u60C5\u4F86\u6E90\u66AB\u6642\u7121\u6CD5\u8B80\u53D6\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u6309\u300C\u66F4\u65B0 K \u7DDA\u300D\u3002");
}
function parseCompanyProfile(html, code) {
  const plain = (value) => xmlText(value.replace(/&nbsp;/gi, " ").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const headings = [...html.matchAll(/<h1\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/h1>/gi)].map((m) => plain(m[1]));
  const title = plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const matches = (value) => new RegExp("^" + code + "(?:\\D|$)").test(value);
  const stockHeadings = headings.filter((h) => /^[1-9]\d{3}(?:\D|$)/.test(h));
  if (stockHeadings.length && !stockHeadings.some(matches)) throw Error("\u8CA1\u5831\u72D7\u9801\u9762\u8207\u80A1\u7968\u4EE3\u865F\u4E0D\u7B26");
  const heading = stockHeadings.find(matches) || (!stockHeadings.length && matches(title) ? title : "");
  if (!heading) throw Error("\u8CA1\u5831\u72D7\u66AB\u672A\u56DE\u50B3\u53EF\u6838\u5C0D\u7684\u516C\u53F8\u9801\u9762\uFF0C\u8ACB\u7A0D\u5F8C\u6309\u300C\u66F4\u65B0\u8CA1\u52D9\u53C3\u8003\u300D\u91CD\u8A66");
  const metrics = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => plain(m[1]));
    if (cells.length < 2 || !/(?:本益比|殖利率|股價淨值比|營收\s*YOY|近\s*4\s*季\s*(?:EPS|ROE))/i.test(cells[0])) continue;
    if (!/^-?\d[\d,]*(?:\.\d+)?%?$/.test(cells[1])) continue;
    metrics.push({ label: cells[0], value: cells[1] });
  }
  const section = html.match(/公司簡介[\s\S]*?(?=<h[1-4]\b|$)/i)?.[0] || "";
  const paragraphs = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plain(m[1])).filter((t) => t.length > 15 && !/^(交易所|產業類別|公司網址)/.test(t));
  const business = section.match(/<div\b[^>]*class=["'][^"']*\bm-0\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const introduction = (business ? plain(business) : paragraphs.at(-1) || "").slice(0, 400);
  if (!metrics.length && !introduction) throw Error("\u8CA1\u5831\u72D7\u516C\u958B\u9801\u9762\u672A\u63D0\u4F9B\u53EF\u8B80\u53D6\u7684\u516C\u53F8\u6216\u8CA1\u52D9\u8CC7\u6599");
  return { code, heading, introduction, metrics: metrics.slice(0, 8), source: "\u8CA1\u5831\u72D7", url: "https://statementdog.com/analysis/" + code, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
function companyMention(title, company, conflicts = []) {
  const text = String(title || "").normalize("NFKC");
  if (new RegExp("(?<!\\d)" + company.code + "(?!\\d)").test(text)) return true;
  let cleaned = text;
  const names = [...conflicts, ...company.code === "2303" ? ["\u53F0\u806F\u96FB"] : []];
  for (const name of [...new Set(names)].sort((a, b) => b.length - a.length)) if (name && name !== company.name) cleaned = cleaned.split(name).join(" ");
  return [company.name, company.full_name].filter((n) => n && n.length >= 2).some((n) => cleaned.includes(n));
}
function trustedSource(source) {
  const key = String(source || "").normalize("NFKC").replace(/\s/g, "").toLowerCase();
  return { "\u4E2D\u592E\u793E": "\u4E2D\u592E\u793E", "\u4E2D\u592E\u793Ecna": "\u4E2D\u592E\u793E", "cna": "\u4E2D\u592E\u793E", "moneydj": "MoneyDJ", "moneydj\u7406\u8CA1\u7DB2": "MoneyDJ", "\u9245\u4EA8\u7DB2": "\u9245\u4EA8\u7DB2", "\u9245\u4EA8": "\u9245\u4EA8\u7DB2", "anue\u9245\u4EA8": "\u9245\u4EA8\u7DB2", "anue\u9245\u4EA8\u7DB2": "\u9245\u4EA8\u7DB2" }[key] || null;
}
function sourceDomain(value) {
  try {
    const h = new URL(value).hostname.toLowerCase();
    return { "www.cna.com.tw": "\u4E2D\u592E\u793E", "cna.com.tw": "\u4E2D\u592E\u793E", "www.moneydj.com": "MoneyDJ", "moneydj.com": "MoneyDJ", "news.cnyes.com": "\u9245\u4EA8\u7DB2" }[h] || null;
  } catch {
    return null;
  }
}
var normalizedTitle = (n) => String(n.title || "").replace(/\s*[-–—|]\s*(中央社(?: CNA)?|MoneyDJ(?:理財網)?|(?:Anue)?鉅亨(?:網)?)\s*$/i, "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function duplicateNews(a, b) {
  if (a.company_code !== b.company_code) return false;
  if (a.url === b.url) return true;
  if (Math.abs(Date.parse(a.published_at) - Date.parse(b.published_at)) > 48 * 36e5) return false;
  const x = normalizedTitle(a), y = normalizedTitle(b);
  if (!x || !y) return false;
  const nums = (n) => (String(n.title || "").normalize("NFKC").match(/\d+(?:[.,]\d+)*/g) || []).sort().join("|");
  if (nums(a) !== nums(b)) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 12) return false;
  const grams = (s) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const gx = grams(x), gy = grams(y);
  const common = [...gx].filter((g) => gy.has(g)).length;
  return 2 * common / (gx.size + gy.size) >= 0.9;
}
function isGeneratedAnswer(value) {
  try {
    const u = new URL(value);
    return ["news.cnyes.com", "gfe-desktop.cnyes.com"].includes(u.hostname) && u.pathname.startsWith("/news/aigc/");
  } catch {
    return false;
  }
}
function curateNews(rows) {
  const rank = { "\u4E2D\u592E\u793E": 0, "MoneyDJ": 1, "\u9245\u4EA8\u7DB2": 2 };
  const candidates = rows.filter((n) => trustedSource(n.source) && !isGeneratedAnswer(n.article_url || n.url)).map((n) => ({ ...n, source: trustedSource(n.source) })).sort((a, b) => Number(!!b.article_summary) - Number(!!a.article_summary) || rank[a.source] - rank[b.source] || String(b.published_at).localeCompare(String(a.published_at)));
  const kept = [];
  for (const n of candidates) if (!kept.some((k) => duplicateNews(k, n))) kept.push(n);
  return kept.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
}
function xmlText(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[entity]) return named[entity];
    const n = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : "";
  });
}
function parsePreview(xml, company, now = /* @__PURE__ */ new Date(), conflicts = []) {
  if (!/<channel[\s>]/.test(xml)) throw Error("Invalid news feed");
  const start = new Date(now);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  start.setUTCDate(Math.min(day, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()));
  const rows = /* @__PURE__ */ new Map();
  for (const match of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const tag = (name) => xmlText(match[1].match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">"))?.[1]);
    const title = tag("title"), link = tag("link"), published = new Date(tag("pubDate"));
    const sourceURL = xmlText(match[1].match(/<source\b[^>]*\burl=["']([^"']+)["']/)?.[1]);
    const source = sourceDomain(sourceURL);
    if (!source) continue;
    if (!companyMention(title, company, conflicts)) continue;
    if (!Number.isFinite(published.getTime()) || published < start || published > now) continue;
    try {
      if (new URL(link).protocol !== "https:") continue;
    } catch {
      continue;
    }
    rows.set(link, { company_code: company.code, title, url: link, source, published_at: published.toISOString(), news_date: new Date(published.getTime() + 8 * 36e5).toISOString().slice(0, 10), preview: true });
  }
  return curateNews([...rows.values()]);
}
var ARTICLE_HOSTS = /* @__PURE__ */ new Set(["www.cna.com.tw", "cna.com.tw", "www.moneydj.com", "moneydj.com", "m.moneydj.com", "news.cnyes.com", "gfe-desktop.cnyes.com"]);
function normalizeArticleURL(value) {
  let u = new URL(value);
  if (["www.google.com", "google.com"].includes(u.hostname) && u.pathname === "/url") {
    const target = u.searchParams.get("url") || u.searchParams.get("q");
    if (target) u = new URL(target);
  }
  if (ARTICLE_HOSTS.has(u.hostname) && u.protocol === "http:" && !u.port) u.protocol = "https:";
  if (u.hostname === "gfe-desktop.cnyes.com") u.hostname = "news.cnyes.com";
  if (u.hostname === "m.moneydj.com" && /f1a\.aspx/i.test(u.pathname)) {
    const id = [...u.searchParams].find(([key]) => key.toLowerCase() === "id")?.[1];
    if (id) u = new URL("https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=" + encodeURIComponent(id));
  }
  return checkedArticleURL(u.href);
}
function checkedArticleURL(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443" || !ARTICLE_HOSTS.has(u.hostname) && u.hostname !== "news.google.com") throw Error("\u4F86\u6E90\u7DB2\u5740\u672A\u652F\u63F4\uFF08" + u.hostname + "\uFF09\uFF1B\u53EA\u63A5\u53D7\u4E09\u5BB6\u65B0\u805E\u4F86\u6E90\u53CA Google News \u539F\u6587\u9023\u7D50");
  return u.href;
}
function extractArticleBody(html) {
  if (/"isAccessibleForFree"\s*:\s*(false|"false")/i.test(html)) throw Error("\u4ED8\u8CBB\u6587\u7AE0\u7121\u6CD5\u53D6\u5F97\u5B8C\u6574\u5167\u6587");
  const bodies = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      if (typeof value.articleBody === "string") bodies.push(value.articleBody);
      Object.values(value).forEach(walk);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(match[1]));
    } catch {
    }
  }
  let text;
  if (bodies.length) text = bodies.sort((a, b) => b.length - a.length)[0];
  else {
    const stack = [], parts = [];
    for (const token of html.matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)) {
      const value = token[0];
      if (value.startsWith("<!--")) continue;
      if (value.startsWith("<")) {
        const tag = value.match(/^<\/?\s*([\w:-]+)/)?.[1]?.toLowerCase();
        if (!tag) continue;
        if (/^<\//.test(value)) {
          const index = stack.map((x) => x.tag).lastIndexOf(tag);
          if (index >= 0) stack.splice(index);
          if (["p", "div", "li", "article"].includes(tag)) parts.push("\n");
        } else {
          const target = tag === "article" || /\b(?:id|class|itemprop)\s*=\s*["'][^"']*(?:centralcontent|paragraph|articlebody|article[-_]content|article__content|articlecontent|article-body|news[-_]content|news_text|maincontent|highlight)/i.test(value);
          if (!["br", "img", "meta", "link", "input", "hr", "source", "wbr"].includes(tag)) stack.push({ tag, target, skip: ["script", "style", "nav", "footer", "aside"].includes(tag) });
          else if (tag === "br") parts.push("\n");
        }
      } else if (stack.some((x) => x.target) && !stack.some((x) => x.skip)) parts.push(value);
    }
    text = parts.join("");
  }
  text = xmlText(text.replace(/<[^>]*>/g, " ")).split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  if (text.length < 80 || /訂閱後閱讀|訂閱即可閱讀|解鎖全文|subscribe to continue/i.test(text)) throw Error("\u7121\u6CD5\u53D6\u5F97\u5B8C\u6574\u5167\u6587\uFF1A\u5167\u5BB9\u4E0D\u8DB3\u3001\u4ED8\u8CBB\u7246\u6216\u9700 JavaScript");
  if (text.length > 4e4) throw Error("\u5168\u6587\u8D85\u904E 40,000 \u5B57\u5143\uFF0C\u4E0D\u6703\u622A\u65B7\u5F8C\u7576\u4F5C\u5168\u6587");
  return text;
}
async function fetchNewsPage(value, body) {
  let url = normalizeArticleURL(value);
  for (let i = 0; i < 6; i++) {
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, { method: body ? "POST" : "GET", body, redirect: "manual", headers: { "User-Agent": "Mozilla/5.0", ...body ? { "Content-Type": "application/x-www-form-urlencoded" } : {} }, signal: AbortSignal.timeout(2e4) });
        if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 1e3));
          continue;
        }
        break;
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = normalizeArticleURL(new URL(response.headers.get("Location"), url).href);
      body = void 0;
      continue;
    }
    if (!response.ok) throw Error("\u65B0\u805E\u4F86\u6E90 HTTP " + response.status);
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const { value: value2, done } = await reader.read();
      if (done) break;
      size += value2.byteLength;
      if (size > 2e6) {
        await reader.cancel();
        throw Error("\u4F86\u6E90\u9801\u9762\u904E\u5927");
      }
      chunks.push(value2);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { url, html: new TextDecoder().decode(bytes) };
  }
  throw Error("\u4F86\u6E90\u8F49\u5740\u904E\u591A");
}
async function resolveArticleURL(value, includePage = false) {
  let url = normalizeArticleURL(value);
  if (new URL(url).hostname === "news.google.com") {
    const id = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    let decoded;
    try {
      const bytes = atob(id.replace(/-/g, "+").replace(/_/g, "/"));
      const candidate = bytes.match(/https?:\/\/[^\x00-\x20\x7f-\xff]+/)?.[0];
      if (candidate) decoded = normalizeArticleURL(candidate);
    } catch {
    }
    if (decoded && ARTICLE_HOSTS.has(new URL(decoded).hostname)) return decoded;
    const page = await fetchNewsPage("https://news.google.com/rss/articles/" + encodeURIComponent(id) + "?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
    if (ARTICLE_HOSTS.has(new URL(page.url).hostname)) return includePage ? page : page.url;
    const signature = xmlText(page.html.match(/data-n-a-sg=["']([^"']+)["']/)?.[1]), timestamp = Number(page.html.match(/data-n-a-ts=["'](\d+)["']/)?.[1]);
    if (!signature || !timestamp) throw Error("Google News \u539F\u6587\u89E3\u6790\u5931\u6557");
    const context = [["zh-TW", "TW", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "TW:zh-Hant", null, 360, null, null, null, null, null, 0, null, null, null], "zh-TW", "TW", 1, [2, 3, 4, 8], 1, 0, "", 0, 0, null, 0];
    const request = JSON.stringify([[["Fbv4je", JSON.stringify(["garturlreq", context, id, timestamp, signature]), null, "generic"]]]);
    const rpc = await fetchNewsPage("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", new URLSearchParams({ "f.req": request }));
    let resolved;
    for (const line of rpc.html.split("\n")) {
      if (!line.trim().startsWith("[")) continue;
      try {
        for (const item of JSON.parse(line)) {
          if (item?.[1] === "Fbv4je") {
            const payload2 = JSON.parse(item[2]);
            if (payload2[0] === "garturlres") resolved = payload2[1];
          }
        }
      } catch {
      }
    }
    if (!resolved) throw Error("Google News \u539F\u6587\u89E3\u6790\u5931\u6557");
    url = normalizeArticleURL(resolved);
  }
  return url;
}
async function readArticleURL(value) {
  const resolved = await resolveArticleURL(value, true);
  if (typeof resolved === "object") return { url: resolved.url, text: extractArticleBody(resolved.html) };
  const url = resolved;
  if (!ARTICLE_HOSTS.has(new URL(url).hostname)) throw Error("\u539F\u6587\u4F86\u6E90\u4E0D\u7B26");
  const page = await fetchNewsPage(url);
  if (!ARTICLE_HOSTS.has(new URL(page.url).hostname)) throw Error("\u539F\u6587\u4F86\u6E90\u4E0D\u7B26");
  return { url: page.url, text: extractArticleBody(page.html) };
}
var encoder = new TextEncoder();
var randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (x) => x.toString(16).padStart(2, "0")).join("");
}
var b642 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function verifyGoogle(token, clientID) {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) throw Error("Invalid identity token");
  const header = JSON.parse(new TextDecoder().decode(b642(head))), claims = JSON.parse(new TextDecoder().decode(b642(body)));
  if (header.alg !== "RS256" || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || claims.aud !== clientID || claims.exp <= Date.now() / 1e3 || !claims.sub || claims.email_verified !== true) throw Error("Invalid identity token");
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(1e4) });
  if (!response.ok) throw Error("Google identity unavailable");
  const jwk = (await response.json()).keys.find((k) => k.kid === header.kid);
  if (!jwk) throw Error("Invalid signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b642(sig), encoder.encode(head + "." + body))) throw Error("Invalid signature");
  return claims;
}
async function dispatch(env, workflow = "news.yml") {
  if (!env.GITHUB_DISPATCH_TOKEN) throw Error("Pages Production \u5C1A\u672A\u8A2D\u5B9A GITHUB_DISPATCH_TOKEN");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO || "")) throw Error("GITHUB_REPO \u683C\u5F0F\u932F\u8AA4\uFF0C\u61C9\u70BA UgiYo/stock-news-calendar");
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, { method: "POST", headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, "User-Agent": "stock-news-calendar", "Accept": "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main", ...workflow === "news.yml" ? { inputs: { mode: "queued" } } : {} }), signal: AbortSignal.timeout(1e4) });
  if (!r.ok) {
    const reason = { 401: "token \u7121\u6548\u6216\u5DF2\u904E\u671F", 403: "token \u6B0A\u9650\u4E0D\u8DB3\uFF0C\u9700 Actions: Read and write\uFF1B\u6216 GitHub \u5B58\u53D6\u9650\u5236", 404: "repo\u3001news.yml \u4E0D\u5B58\u5728\uFF0C\u6216 token \u672A\u7372\u6388\u6B0A\u5B58\u53D6\u6B64 repo", 422: "workflow \u7684 main \u5206\u652F\u6216 workflow_dispatch \u8A2D\u5B9A\u4E0D\u7B26" };
    throw Error("GitHub HTTP " + r.status + "\uFF1A" + (reason[r.status] || "\u555F\u52D5\u8ACB\u6C42\u5931\u6557"));
  }
  return true;
}
var index_default = { async fetch(req, env) {
  const url = new URL(req.url), path = url.pathname;
  let appURL;
  try {
    appURL = new URL(String(env.APP_URL || "").trim());
    if (!["https:", "http:"].includes(appURL.protocol) || appURL.username || appURL.password || appURL.search || appURL.hash) throw Error("Invalid APP_URL");
    if (!appURL.pathname.endsWith("/")) appURL.pathname += "/";
  } catch {
    return Response.json({ error: "APP_URL \u5C1A\u672A\u8A2D\u5B9A\u6216\u683C\u5F0F\u932F\u8AA4\u3002\u8ACB\u5728 Worker Settings \u2192 Variables and Secrets \u65B0\u589E Text \u8B8A\u6578 APP_URL\uFF0C\u503C\u70BA https://ugiyo.github.io/stock-news-calendar/\uFF0C\u5132\u5B58\u4E26\u91CD\u65B0\u90E8\u7F72\u3002" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const origin = appURL.origin;
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Cache-Control": "no-store", "Vary": "Origin" };
  const reply = (data, status = 200) => Response.json(data, { status, headers });
  const sql = (q, ...args) => env.DB.prepare(q).bind(...args);
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.headers.get("Origin") && req.headers.get("Origin") !== origin) return reply({ error: "Origin not allowed" }, 403);
    if (path === "/health") {
      const missing = ["DB", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "COLLECTOR_SECRET"].filter((k) => !env[k]);
      return reply({ ok: missing.length === 0, missing }, missing.length ? 503 : 200);
    }
    if (path === "/podcasts/rss" && req.method === "GET") {
      let feed;
      try {
        feed = new URL(url.searchParams.get("url") || "");
      } catch {
        return reply({ error: "RSS \u7DB2\u5740\u683C\u5F0F\u932F\u8AA4" }, 400);
      }
      if (feed.protocol !== "https:" || feed.username || feed.password || feed.search || feed.hash) return reply({ error: "RSS \u5FC5\u9808\u662F\u6C92\u6709\u5E33\u5BC6\u8207\u67E5\u8A62\u53C3\u6578\u7684 HTTPS \u7DB2\u5740" }, 400);
      const soundOnFeed = feed.hostname === "feeds.soundon.fm" && /^\/podcasts\/[0-9a-f-]+\.xml$/.test(feed.pathname);
      const response = await fetch(feed.href, { redirect: soundOnFeed ? "follow" : "manual", headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" }, signal: AbortSignal.timeout(2e4) });
      if (!response.ok) return reply({ error: "RSS \u4F86\u6E90 HTTP " + response.status }, 502);
      const reader = response.body?.getReader();
      if (!reader) return new Response(await response.text(), { headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" } });
      const chunks = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 12e6) {
          await reader.cancel();
          return reply({ error: "RSS \u8D85\u904E 12 MB" }, 413);
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(bytes, { headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" } });
    }
    if (path === "/auth/start") {
      const state = randomToken(), verifier = randomToken();
      await sql("DELETE FROM oauth_states WHERE expires_at<?", Date.now()).run();
      await sql("INSERT INTO oauth_states VALUES(?,?,?)", state, verifier, Date.now() + 6e5).run();
      const challenge = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
      const encoded = btoa(String.fromCharCode(...new Uint8Array(challenge))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + "/auth/callback", response_type: "code", scope: "openid email profile", state, code_challenge: encoded, code_challenge_method: "S256", prompt: "select_account" });
      return new Response(null, { status: 302, headers: { Location: "https://accounts.google.com/o/oauth2/v2/auth?" + params, "Set-Cookie": `oauth_state=${state}; Secure; HttpOnly; SameSite=Lax; Max-Age=600; Path=/auth` } });
    }
    if (path === "/auth/callback") {
      const state = url.searchParams.get("state"), cookie = req.headers.get("Cookie") || "";
      if (!state || !cookie.split(";").some((x) => x.trim() === "oauth_state=" + state)) return reply({ error: "Invalid OAuth state" }, 400);
      const row = await sql("DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING *", state, Date.now()).first();
      if (!row) return reply({ error: "OAuth request expired" }, 400);
      if (!url.searchParams.get("code")) return new Response(null, { status: 302, headers: { Location: appURL.href + "#login_error=cancelled" } });
      const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + "/auth/callback", grant_type: "authorization_code", code_verifier: row.verifier }), signal: AbortSignal.timeout(15e3) });
      if (!response.ok) throw Error("Google login failed");
      const identity = await verifyGoogle((await response.json()).id_token, env.GOOGLE_CLIENT_ID);
      await sql("INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email", identity.sub, identity.email).run();
      const token2 = randomToken();
      await sql("DELETE FROM sessions WHERE expires_at<?", Date.now()).run();
      await sql("INSERT INTO sessions VALUES(?,?,?)", await hash(token2), identity.sub, Date.now() + 30 * 864e5).run();
      return new Response(null, { status: 302, headers: { Location: appURL.href + "#session=" + token2, "Set-Cookie": "oauth_state=; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Path=/auth", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }
    if (path.startsWith("/admin/")) {
      const provided = req.headers.get("Authorization") || "";
      if (!env.COLLECTOR_SECRET || await hash(provided) !== await hash("Bearer " + env.COLLECTOR_SECRET)) return reply({ error: "Forbidden" }, 403);
      const podcasts2 = await sharedPodcastsRoute(req, { sql, reply, admin: true, hash });
      if (podcasts2) return podcasts2;
      const personal2 = await aiJobsRoute(req, env, { admin: true, reply, dispatch, readArticleURL });
      if (personal2) return personal2;
      if (path === "/admin/company-profile-probe") {
        const code = url.searchParams.get("code");
        if (!/^[1-9]\d{3}$/.test(code || "")) return reply({ error: "Invalid code" }, 400);
        const r = await fetch("https://statementdog.com/analysis/" + code, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }, redirect: "manual", signal: AbortSignal.timeout(1e4) });
        const html = await r.text();
        let error = "";
        try {
          parseCompanyProfile(html, code);
        } catch (e) {
          error = e.message;
        }
        return reply({ status: r.status, bytes: html.length, title: xmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 150), error });
      }
      if (path === "/admin/company-profiles") {
        await sql("CREATE TABLE IF NOT EXISTS company_profiles(code TEXT PRIMARY KEY,payload TEXT,state TEXT,requested_at INTEGER,updated_at INTEGER,error TEXT)").run();
        if (req.method === "GET") return reply({ codes: (await sql("SELECT code FROM company_profiles WHERE state='queued' OR updated_at<? ORDER BY requested_at DESC LIMIT 100", Date.now() - 864e5).all()).results.map((r) => r.code) });
        const b = await req.json();
        if (!/^[1-9]\d{3}$/.test(b.code || "") || !await sql("SELECT code FROM companies WHERE code=?", b.code).first()) return reply({ error: "Invalid company" }, 400);
        if (b.error) {
          await sql("UPDATE company_profiles SET state='failed',error=? WHERE code=?", String(b.error).slice(0, 200), b.code).run();
          return reply({ ok: true });
        }
        let profile;
        if (b.official) {
          const company = await sql("SELECT * FROM companies WHERE code=?", b.code).first(), o = b.official;
          if (o.name !== company.name && o.full_name !== company.full_name) return reply({ error: "Official company mismatch" }, 400);
          if (typeof o.introduction !== "string" || !Array.isArray(o.metrics) || o.metrics.length > 3 || o.metrics.some((m) => !["\u5BE6\u6536\u8CC7\u672C\u984D\uFF08\u5143\uFF09", "\u5DF2\u767C\u884C\u666E\u901A\u80A1\u6578\uFF08\u80A1\uFF09"].includes(m.label) || !/^\d[\d,]*(?:\.\d+)?$/.test(m.value))) return reply({ error: "Invalid official facts" }, 400);
          const otc = company.market === "\u4E0A\u6AC3";
          profile = { code: b.code, heading: b.code + " " + o.name, introduction: o.introduction.slice(0, 400), metrics: o.metrics, source: otc ? "\u6AC3\u8CB7\u4E2D\u5FC3" : "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240", url: otc ? "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" : "https://openapi.twse.com.tw/v1/opendata/t187ap03_L", fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), notice: "\u8CA1\u5831\u72D7\u516C\u958B\u9801\u9762\u66AB\u6642\u7121\u6CD5\u53D6\u5F97\uFF0C\u76EE\u524D\u63A1\u7528\u4EA4\u6613\u6240\u516C\u958B\u516C\u53F8\u57FA\u672C\u8CC7\u6599\u3002" };
        } else {
          if (typeof b.html !== "string" || b.html.length > 2e6) return reply({ error: "Invalid page" }, 400);
          profile = parseCompanyProfile(b.html, b.code);
        }
        await sql("INSERT INTO company_profiles(code,payload,state,updated_at) VALUES(?,?,'ready',?) ON CONFLICT(code) DO UPDATE SET payload=excluded.payload,state='ready',updated_at=excluded.updated_at,error=NULL", b.code, JSON.stringify(profile), Date.now()).run();
        return reply({ ok: true, code: profile.code, metrics: profile.metrics.length });
      }
      if (path === "/admin/ranking-audit") {
        try {
          return reply({ snapshots: (await sql("SELECT date,payload FROM rankings ORDER BY date DESC LIMIT 60").all()).results.map((r) => {
            const p = JSON.parse(r.payload);
            return { date: r.date, previousDate: Array.isArray(p) ? null : p.previousDate };
          }) });
        } catch (e) {
          if (String(e.message).includes("no such table")) return reply({ snapshots: [] });
          throw e;
        }
      }
      if (path === "/admin/ranking-link" && req.method === "POST") {
        const b = await req.json();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || !/^\d{4}-\d{2}-\d{2}$/.test(b.previousDate || "") || b.previousDate >= b.date) return reply({ error: "Invalid dates" }, 400);
        const row = await sql("SELECT payload FROM rankings WHERE date=?", b.date).first(), prior = await sql("SELECT date FROM rankings WHERE date=?", b.previousDate).first();
        if (!row || !prior) return reply({ error: "Missing snapshot" }, 409);
        const p = JSON.parse(row.payload);
        await sql("UPDATE rankings SET payload=? WHERE date=?", JSON.stringify({ stocks: Array.isArray(p) ? p : p.stocks, previousDate: b.previousDate }), b.date).run();
        return reply({ ok: true });
      }
      if (path === "/admin/chart-codes") {
        const codes = new Set((await sql("SELECT DISTINCT company_code AS code FROM watchlists").all()).results.map((r) => r.code));
        try {
          for (const row of (await sql("SELECT payload FROM rankings ORDER BY date DESC LIMIT 60").all()).results) {
            const p = JSON.parse(row.payload), stocks = Array.isArray(p) ? p : p.stocks;
            for (const r of [...stocks].sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)).slice(0, 10)) codes.add(r.code);
          }
        } catch (e) {
          if (!String(e.message).includes("no such table")) throw e;
        }
        if (!codes.size) return reply({ companies: [] });
        const hasPrices = await sql("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").first(), list = [...codes], companies = [];
        for (let i = 0; i < list.length; i += 100) {
          const chunk = list.slice(i, i + 100), placeholders = chunk.map(() => "?").join(",");
          const query = hasPrices ? `SELECT c.*,(SELECT MAX(date) FROM prices p WHERE p.code=c.code) AS last_price_date,(SELECT group_concat(month) FROM (SELECT substr(date,1,7) AS month FROM prices p WHERE p.code=c.code AND p.open>0 AND p.high>0 AND p.low>0 GROUP BY month HAVING count(*)>=10)) AS price_months FROM companies c WHERE code IN (${placeholders})` : `SELECT * FROM companies WHERE code IN (${placeholders})`;
          companies.push(...(await sql(query, ...chunk).all()).results);
        }
        return reply({ companies });
      }
      if (path === "/admin/ranking-dates") {
        try {
          return reply({ dates: (await sql("SELECT date FROM rankings ORDER BY date DESC LIMIT 60").all()).results.map((r) => r.date) });
        } catch (e) {
          if (String(e.message).includes("no such table")) return reply({ dates: [] });
          throw e;
        }
      }
      if (path === "/admin/ranking" && req.method === "POST") {
        const b = await req.json();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Array.isArray(b.stocks) || b.stocks.length > 5e3 || b.stocks.some((r) => !/^\d{4}$/.test(r.code) || !r.name || !r.tag || !["\u4E0A\u5E02", "\u4E0A\u6AC3"].includes(r.market) || !Number.isFinite(r.amount) || r.amount < 0)) return reply({ error: "Invalid ranking" }, 400);
        await sql("CREATE TABLE IF NOT EXISTS rankings(date TEXT PRIMARY KEY,payload TEXT NOT NULL)").run();
        await sql("INSERT INTO rankings(date,payload) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload WHERE rankings.payload<>excluded.payload", b.date, JSON.stringify({ stocks: b.stocks, previousDate: /^\d{4}-\d{2}-\d{2}$/.test(b.previousDate || "") ? b.previousDate : null })).run();
        await sql("DELETE FROM rankings WHERE date NOT IN (SELECT date FROM rankings ORDER BY date DESC LIMIT 60)").run();
        return reply({ ok: true });
      }
      if (path === "/admin/prices" && req.method === "POST") {
        const { prices } = await req.json();
        if (!Array.isArray(prices) || prices.length > 20 || prices.some((p) => !/^(\d{4,6}|TAIEX)$/.test(p.code) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(p.close) || p.close <= 0)) return reply({ error: "Invalid prices" }, 400);
        await sql("CREATE TABLE IF NOT EXISTS prices(code TEXT NOT NULL,date TEXT NOT NULL,open REAL,high REAL,low REAL,close REAL NOT NULL,volume REAL,PRIMARY KEY(code,date))").run();
        if (prices.length) await env.DB.batch(prices.map((p) => sql("INSERT INTO prices(code,date,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume WHERE prices.open IS NOT excluded.open OR prices.high IS NOT excluded.high OR prices.low IS NOT excluded.low OR prices.close IS NOT excluded.close OR prices.volume IS NOT excluded.volume", p.code, p.date, p.open ?? null, p.high ?? null, p.low ?? null, p.close, p.volume ?? null)));
        return reply({ ok: true });
      }
      if (path === "/admin/companies" && req.method === "POST") {
        const { companies } = await req.json();
        if (!Array.isArray(companies) || companies.length > 100) return reply({ error: "Invalid batch" }, 400);
        await env.DB.batch(companies.map((c) => {
          if (!/^\d{4,6}$/.test(c.code) || !c.name || !["\u4E0A\u5E02", "\u4E0A\u6AC3"].includes(c.market)) throw Error("Invalid company");
          return sql("INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,full_name=excluded.full_name,market=excluded.market WHERE companies.name IS NOT excluded.name OR companies.full_name IS NOT excluded.full_name OR companies.market IS NOT excluded.market", c.code, c.name, c.full_name, c.market);
        }));
        return reply({ ok: true });
      }
      if (path === "/admin/company-aliases") {
        const c = await sql("SELECT * FROM companies WHERE code=?", url.searchParams.get("code")).first();
        if (!c) return reply({ error: "\u516C\u53F8\u4E0D\u5B58\u5728" }, 404);
        return reply({ names: (await sql("SELECT name FROM companies WHERE code<>? AND name<>? AND instr(name,?)>0", c.code, c.name, c.name).all()).results.map((x) => x.name) });
      }
      if (path === "/admin/tracked") return reply({ companies: (await sql("SELECT DISTINCT c.* FROM companies c JOIN watchlists w ON c.code=w.company_code").all()).results });
      if (path === "/admin/claim" && req.method === "POST") {
        await sql("UPDATE jobs SET status='pending' WHERE status='running' AND claimed_at<?", Date.now() - 20 * 6e4).run();
        const jobs = (await sql("UPDATE jobs SET status='running',claimed_at=? WHERE id IN (SELECT id FROM jobs WHERE status='pending' ORDER BY created_at LIMIT 1) RETURNING *", Date.now()).all()).results;
        return reply({ jobs });
      }
      if (path === "/admin/job" && req.method === "POST") {
        const b = await req.json();
        await sql("UPDATE jobs SET status=?,error=? WHERE id=?", b.error ? "failed" : "done", b.error || null, b.id).run();
        return reply({ ok: true });
      }
      if (path === "/admin/news" && req.method === "POST") {
        const b = await req.json();
        if (!Array.isArray(b.news) || b.news.length > 20) return reply({ error: "Invalid batch" }, 400);
        const candidates = curateNews(b.news), stored = [];
        for (const code of [...new Set(candidates.map((n) => n.company_code))]) {
          const dates = candidates.filter((n) => n.company_code === code).map((n) => n.news_date).sort();
          if (!/^\d{4,6}$/.test(code) || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return reply({ error: "Invalid news" }, 400);
          const from = new Date(Date.parse(dates[0]) - 2 * 864e5).toISOString().slice(0, 10), to = new Date(Date.parse(dates.at(-1)) + 2 * 864e5).toISOString().slice(0, 10);
          stored.push(...(await sql("SELECT * FROM news WHERE news_date BETWEEN ? AND ? AND company_code=?", from, to, code).all()).results);
        }
        const accepted = [];
        for (const n of candidates) if (!stored.some((k) => trustedSource(k.source) && k.url !== n.url && duplicateNews(k, n))) accepted.push(n);
        if (accepted.length) await env.DB.batch(accepted.map((n) => {
          if (!/^\d{4,6}$/.test(n.company_code) || !/^https:\/\//.test(n.url) || !/^\d{4}-\d{2}-\d{2}$/.test(n.news_date)) throw Error("Invalid news");
          return sql("INSERT INTO news(company_code,title,url,source,published_at,news_date) VALUES(?,?,?,?,?,?) ON CONFLICT(company_code,url) DO UPDATE SET title=excluded.title,source=excluded.source,published_at=excluded.published_at,news_date=excluded.news_date WHERE news.title IS NOT excluded.title OR news.source IS NOT excluded.source OR news.published_at IS NOT excluded.published_at OR news.news_date IS NOT excluded.news_date", n.company_code, n.title, n.url, n.source, n.published_at, n.news_date);
        }));
        return reply({ ok: true });
      }
      if (path === "/admin/company" && req.method === "POST") {
        const b = await req.json();
        await sql("UPDATE companies SET last_collected_at=COALESCE(?,last_collected_at),last_error=? WHERE code=?", b.updated_at || null, b.error || null, b.code).run();
        return reply({ ok: true });
      }
      if (path === "/admin/article-links") {
        if (req.method === "POST") {
          const b = await req.json();
          let direct;
          try {
            direct = normalizeArticleURL(b.url);
          } catch {
            return reply({ error: "Invalid article link" }, 400);
          }
          if (!ARTICLE_HOSTS.has(new URL(direct).hostname) || !Number.isSafeInteger(b.id)) return reply({ error: "Invalid article link" }, 400);
          await sql("UPDATE news SET article_url=? WHERE id=? AND article_url IS NOT ?", direct, b.id, direct).run();
          return reply({ ok: true });
        }
        const code = url.searchParams.get("code");
        if (code && !/^\d{4,6}$/.test(code)) return reply({ error: "Invalid code" }, 400);
        const query = "SELECT id,title,url,article_url FROM news WHERE source IN ('MoneyDJ','MoneyDJ\u7406\u8CA1\u7DB2','\u4E2D\u592E\u793E','\u4E2D\u592E\u793E CNA','\u9245\u4EA8\u7DB2','\u9245\u4EA8','Anue\u9245\u4EA8','news.cnyes.com') AND (article_url IS NULL OR article_url LIKE 'https://news.google.com/%')";
        return reply({ news: (await sql(query + (code ? " AND company_code=?" : "") + " ORDER BY news_date DESC,id DESC LIMIT 100", ...code ? [code] : []).all()).results });
      }
      if (path === "/admin/article-probe") {
        if (req.method === "POST") {
          const b = await req.json();
          try {
            const result = await readArticleURL(b.url);
            return reply({ ok: true, url: result.url, characters: result.text.length });
          } catch (e) {
            return reply({ ok: false, error: e.message }, 422);
          }
        }
        const code = url.searchParams.get("code"), date = url.searchParams.get("date");
        if (!/^\d{4,6}$/.test(code || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return reply({ error: "Invalid probe range" }, 400);
        return reply({ news: (await sql("SELECT id,title,url,article_url FROM news WHERE company_code=? AND news_date=? AND source IN ('MoneyDJ','MoneyDJ\u7406\u8CA1\u7DB2','\u9245\u4EA8\u7DB2','news.cnyes.com','\u4E2D\u592E\u793E') ORDER BY id LIMIT 10", code, date).all()).results });
      }
      if (path === "/admin/summary-cache") return summaryCacheRoute(req, { sql, reply, user: { id: "collector" }, randomToken });
      if (path === "/admin/article") return reply({ news: await sql("SELECT * FROM news WHERE id=?", url.searchParams.get("id")).first() });
      if (path === "/admin/summary" && req.method === "POST") {
        const b = await req.json();
        await sql("UPDATE news SET article_summary=?,summary_status=?,summary_method=?,summary_error=?,summary_updated_at=?,article_url=COALESCE(?,article_url) WHERE id=?", b.article_summary || null, b.article_summary ? "ready" : "unavailable", b.summary_method || null, b.summary_error || null, (/* @__PURE__ */ new Date()).toISOString(), b.article_url || null, b.id).run();
        return reply({ ok: true });
      }
      return reply({ error: "Not found" }, 404);
    }
    const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
    if (!token) return reply({ error: "\u8ACB\u5148\u767B\u5165" }, 401);
    const user = await sql("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", await hash(token), Date.now()).first();
    if (!user) return reply({ error: "\u767B\u5165\u5DF2\u904E\u671F\uFF0C\u8ACB\u91CD\u65B0\u767B\u5165" }, 401);
    const accountResults = await accountResultsRoute(req, { sql, reply, user });
    if (accountResults) return accountResults;
    const podcasts = await sharedPodcastsRoute(req, { sql, reply, user, hash });
    if (podcasts) return podcasts;
    if (path === "/portfolio-quotes") {
      const codes = [...new Set((url.searchParams.get("codes") || "").split(",").filter(Boolean))];
      if (!codes.length) return reply({ quotes: [] });
      if (codes.length > 100 || codes.some((c) => !/^\d{4,6}$/.test(c))) return reply({ error: "Invalid codes" }, 400);
      try {
        return reply({ quotes: (await sql(`SELECT p.code,p.date,p.close FROM prices p WHERE p.code IN (${codes.map(() => "?").join(",")}) AND p.date=(SELECT MAX(q.date) FROM prices q WHERE q.code=p.code)`, ...codes).all()).results });
      } catch (e) {
        if (String(e.message).includes("no such table")) return reply({ quotes: [] });
        throw e;
      }
    }
    if (path === "/intraday") {
      const code = url.searchParams.get("code"), interval = url.searchParams.get("interval") || "5m";
      if (!/^[1-9]\d{3}$/.test(code || "") || !["1m", "5m", "15m", "60m"].includes(interval)) return reply({ error: "Invalid interval" }, 400);
      const company = await sql("SELECT * FROM companies WHERE code=?", code).first();
      if (!company) return reply({ error: "\u516C\u53F8\u4E0D\u5B58\u5728" }, 404);
      const symbol = code + (company.market === "\u4E0A\u6AC3" ? ".TWO" : ".TW"), key = new Request(url.origin + "/cache/intraday/" + symbol + "/" + interval), cache = globalThis.caches?.default;
      const cached = url.searchParams.get("refresh") === "1" ? null : await cache?.match(key);
      if (cached) return reply(await cached.json());
      let result;
      for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
        try {
          const response = await fetch(`https://${host}/v8/finance/chart/${symbol}?interval=${interval}&range=5d&includePrePost=false`, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(1e4) });
          if (response.ok) {
            result = (await response.json()).chart?.result?.[0];
            if (result) break;
          }
        } catch {
        }
      }
      if (!result || result.meta?.symbol !== symbol) return reply({ error: "\u5206\u9418\u884C\u60C5\u4F86\u6E90\u66AB\u6642\u7121\u6CD5\u8B80\u53D6\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66\uFF1B\u65E5\u9031\u6708 K \u4ECD\u53EF\u4F7F\u7528\u3002" }, 502);
      const quote = result.indicators?.quote?.[0], prices = [];
      for (const [i, timestamp] of (result.timestamp || []).entries()) {
        const open = quote?.open?.[i], high = quote?.high?.[i], low = quote?.low?.[i], close = quote?.close?.[i], volume = quote?.volume?.[i];
        if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0) || low > Math.min(open, close) || high < Math.max(open, close)) continue;
        const time = new Date(timestamp * 1e3 + 8 * 36e5), minutes = time.getUTCHours() * 60 + time.getUTCMinutes();
        if (minutes < 540 || minutes > 810) continue;
        prices.push({ date: time.toISOString().slice(0, 16).replace("T", " "), timestamp, open, high, low, close, volume: Number.isFinite(volume) ? volume : null });
      }
      const data = { prices, source: "Yahoo Finance", interval, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      if (cache) await cache.put(key, Response.json(data, { headers: { "Cache-Control": "public, max-age=180" } }));
      return reply(data);
    }
    if (path === "/company-profile") {
      const code = url.searchParams.get("code");
      if (!/^[1-9]\d{3}$/.test(code || "")) return reply({ error: "Invalid stock code" }, 400);
      if (!await sql("SELECT code FROM companies WHERE code=?", code).first()) return reply({ error: "\u516C\u53F8\u4E0D\u5B58\u5728" }, 404);
      await sql("CREATE TABLE IF NOT EXISTS company_profiles(code TEXT PRIMARY KEY,payload TEXT,state TEXT,requested_at INTEGER,updated_at INTEGER,error TEXT)").run();
      const stored = await sql("SELECT * FROM company_profiles WHERE code=?", code).first();
      if (stored?.state === "queued" && stored.requested_at > Date.now() - 3e5) return reply({ pending: true, profile: stored.payload ? JSON.parse(stored.payload) : void 0 });
      if (req.method !== "POST" && stored?.payload && stored.updated_at > Date.now() - 864e5) return reply({ profile: JSON.parse(stored.payload), warning: JSON.parse(stored.payload).notice || "" });
      const key = new Request(url.origin + "/cache/company-profile/" + code), cache = globalThis.caches?.default, cached = await cache?.match(key);
      if (req.method !== "POST" && cached) return reply({ profile: await cached.json() });
      try {
        let target = "https://statementdog.com/analysis/" + code, response;
        for (let i = 0; i < 3; i++) {
          response = await fetch(target, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }, signal: AbortSignal.timeout(1e4) });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const next = new URL(response.headers.get("Location") || "", target);
          if (next.protocol !== "https:" || !["statementdog.com", "www.statementdog.com"].includes(next.hostname) || next.username || next.password || next.port) throw Error("\u8CA1\u5831\u72D7\u4F86\u6E90\u8F49\u5740\u4E0D\u7B26");
          target = next.href;
        }
        if (!response?.ok) throw Error("\u8CA1\u5831\u72D7\u516C\u958B\u8CC7\u8A0A\u66AB\u6642\u7121\u6CD5\u8B80\u53D6");
        const html = await response.text();
        if (html.length > 2e6) throw Error("\u8CA1\u5831\u72D7\u9801\u9762\u8D85\u904E\u8B80\u53D6\u4E0A\u9650");
        const profile = parseCompanyProfile(html, code);
        await sql("INSERT INTO company_profiles(code,payload,state,updated_at) VALUES(?,?,'ready',?) ON CONFLICT(code) DO UPDATE SET payload=excluded.payload,state='ready',updated_at=excluded.updated_at,error=NULL", code, JSON.stringify(profile), Date.now()).run();
        if (cache) await cache.put(key, Response.json(profile, { headers: { "Cache-Control": "public, max-age=86400" } }));
        return reply({ profile });
      } catch (e) {
        const old = stored?.payload ? JSON.parse(stored.payload) : cached ? await cached.json() : void 0;
        if (stored?.state === "failed" && req.method !== "POST") return old ? reply({ profile: old, warning: "\u8CA1\u52D9\u66F4\u65B0\u66AB\u6642\u5931\u6557\uFF0C\u53EF\u6309\u91CD\u8A66\u3002" }) : reply({ error: "\u8CA1\u5831\u72D7\u516C\u958B\u8CC7\u6599\u66AB\u6642\u7121\u6CD5\u53D6\u5F97\uFF0C\u8ACB\u6309\u91CD\u8A66\u8CA1\u52D9\u53C3\u8003\u3002" }, 502);
        await sql("INSERT INTO company_profiles(code,state,requested_at,error) VALUES(?,'queued',?,?) ON CONFLICT(code) DO UPDATE SET state='queued',requested_at=excluded.requested_at,error=excluded.error", code, Date.now(), e.message).run();
        try {
          await dispatch(env, "company-profiles.yml");
          return reply({ pending: true, profile: old });
        } catch (dispatchError) {
          await sql("UPDATE company_profiles SET state='failed',error=? WHERE code=?", dispatchError.message, code).run();
          return old ? reply({ profile: old, warning: "\u8CA1\u52D9\u66F4\u65B0\u66AB\u6642\u7121\u6CD5\u555F\u52D5\uFF0C\u53EF\u6309\u91CD\u8A66\u3002" }) : reply({ error: "\u8CA1\u52D9\u8CC7\u6599\u66F4\u65B0\u66AB\u6642\u7121\u6CD5\u555F\u52D5\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66\u3002" }, 502);
        }
      }
    }
    if (path === "/chart-prices") {
      const code = url.searchParams.get("code");
      if (!/^[1-9]\d{3}$/.test(code || "")) return reply({ error: "Invalid stock code" }, 400);
      let prices = [];
      try {
        prices = (await sql("SELECT * FROM prices WHERE code=? AND date>=date('now','-2 years') ORDER BY date", code).all()).results;
      } catch (e) {
        if (!String(e.message).includes("no such table")) throw e;
      }
      const usable = prices.filter((p) => [p.open, p.high, p.low, p.close].every((v) => Number.isFinite(v) && v > 0) && p.low <= Math.min(p.open, p.close) && p.high >= Math.max(p.open, p.close));
      const shortHistory = usable.length && usable[0].date > new Date(Date.now() - 700 * 864e5).toISOString().slice(0, 10);
      let recentlyChecked = false;
      if (shortHistory) {
        await sql("CREATE TABLE IF NOT EXISTS price_history_sync(code TEXT PRIMARY KEY,updated_at INTEGER NOT NULL)").run();
        recentlyChecked = !!await sql("SELECT code FROM price_history_sync WHERE code=? AND updated_at>?", code, Date.now() - 864e5).first();
      }
      if (req.method === "POST" || !usable.length || shortHistory && !recentlyChecked) {
        try {
          const company = await sql("SELECT * FROM companies WHERE code=?", code).first();
          if (!company) return usable.length ? reply({ prices, refreshed: false }) : reply({ error: "\u516C\u53F8\u4E0D\u5B58\u5728" }, 404);
          const { rows, source } = await fetchDailyBars(company);
          await sql("CREATE TABLE IF NOT EXISTS prices(code TEXT NOT NULL,date TEXT NOT NULL,open REAL,high REAL,low REAL,close REAL NOT NULL,volume REAL,PRIMARY KEY(code,date))").run();
          for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50).map((p) => sql("INSERT INTO prices(code,date,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume", p.code, p.date, p.open, p.high, p.low, p.close, p.volume)));
          await sql("CREATE TABLE IF NOT EXISTS price_history_sync(code TEXT PRIMARY KEY,updated_at INTEGER NOT NULL)").run();
          await sql("INSERT INTO price_history_sync VALUES(?,?) ON CONFLICT(code) DO UPDATE SET updated_at=excluded.updated_at", code, Date.now()).run();
          return reply({ prices: (await sql("SELECT * FROM prices WHERE code=? AND date>=date('now','-2 years') ORDER BY date", code).all()).results, source, refreshed: true });
        } catch (e) {
          if (!usable.length) return reply({ error: e.message }, 502);
          return reply({ prices, refreshed: false, warning: e.message });
        }
      }
      return reply({ prices, refreshed: false });
    }
    if (path === "/ranking-stock") {
      const code = url.searchParams.get("code");
      if (!/^[1-9]\d{3}$/.test(code || "")) return reply({ error: "Invalid stock code" }, 400);
      try {
        const snapshots = (await sql("SELECT date,payload FROM rankings ORDER BY date LIMIT 60").all()).results;
        const history = [];
        let stock = null;
        for (const snapshot of snapshots) {
          const p = JSON.parse(snapshot.payload), rows = Array.isArray(p) ? p : p.stocks, found = rows.find((r) => r.code === code);
          if (found) stock = found;
          const rank = found ? 1 + rows.filter((r) => r.amount > found.amount || r.amount === found.amount && r.code < code).length : null;
          history.push({ date: snapshot.date, previousDate: Array.isArray(p) ? null : p.previousDate, amount: found?.amount ?? null, rank });
        }
        return reply({ stock, history });
      } catch (e) {
        if (String(e.message).includes("no such table")) return reply({ stock: null, history: [] });
        throw e;
      }
    }
    if (path === "/ranking") {
      const requested = url.searchParams.get("date");
      if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return reply({ error: "Invalid date" }, 400);
      try {
        const snapshots = (await sql("SELECT date,payload FROM rankings ORDER BY date DESC LIMIT 60").all()).results, rows = snapshots.map((r) => {
          const p = JSON.parse(r.payload);
          return { date: r.date, stocks: Array.isArray(p) ? p : p.stocks, previousDate: Array.isArray(p) ? null : p.previousDate };
        }), dates = rows.map((r) => r.date), date = requested || dates[0], row = rows.find((r) => r.date === date), previous = row?.previousDate ? rows.find((r) => r.date === row.previousDate) : null, history = rows.slice().reverse().map((r) => {
          const total = r.stocks.reduce((sum, x) => sum + x.amount, 0), sectors = {};
          for (const x of r.stocks) {
            sectors[x.tag] ??= { amount: 0, count: 0, topCount: 0 };
            sectors[x.tag].amount += x.amount;
            sectors[x.tag].count++;
          }
          for (const x of [...r.stocks].sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)).slice(0, 10)) sectors[x.tag].topCount++;
          return { date: r.date, previousDate: r.previousDate, total, sectors, turnover: r.stocks.map((x) => [x.code, x.amount]) };
        });
        const capSnapshot = rows.find((r) => r.stocks.some((s) => Number.isFinite(s.marketCap) && s.marketCap > 0));
        const marketCaps = capSnapshot ? { date: capSnapshot.date, stocks: capSnapshot.stocks.filter((s) => Number.isFinite(s.marketCap) && s.marketCap > 0).map((s) => ({ code: s.code, name: s.name, value: s.marketCap })) } : null;
        return reply({ date: date || null, dates, stocks: row?.stocks || [], previousDate: previous?.date || row?.previousDate || null, previousStocks: previous?.stocks || null, history, marketCaps });
      } catch (e) {
        if (String(e.message).includes("no such table")) return reply({ date: null, dates: [], stocks: [], history: [] });
        throw e;
      }
    }
    if (path === "/prices") {
      const code = url.searchParams.get("code");
      if (!await sql("SELECT 1 FROM watchlists WHERE user_id=? AND company_code=?", user.id, code).first()) return reply({ error: "\u8ACB\u5148\u8FFD\u8E64\u516C\u53F8" }, 403);
      try {
        return reply({ prices: (await sql("SELECT * FROM prices WHERE code IN (?, 'TAIEX') AND date>=date('now','-2 years') ORDER BY date", code).all()).results });
      } catch (e) {
        if (String(e.message).includes("no such table")) return reply({ prices: [] });
        throw e;
      }
    }
    if (path === "/article-content" && req.method === "POST") {
      const b = await req.json();
      if (Object.keys(b).some((k) => k !== "url") || typeof b.url !== "string" || b.url.length > 3e3) return reply({ error: "\u50C5\u63A5\u53D7\u65B0\u805E\u7DB2\u5740\uFF0C\u4E0D\u53EF\u50B3\u9001 AI \u8A2D\u5B9A\u6216\u91D1\u9470" }, 400);
      try {
        const saved = await sql("SELECT article_url FROM news WHERE url=? AND article_url IS NOT NULL LIMIT 1", b.url).first();
        return reply(await readArticleURL(saved?.article_url || b.url));
      } catch (e) {
        return reply({ error: e.message || "\u7121\u6CD5\u8B80\u53D6\u5B8C\u6574\u65B0\u805E\u5167\u6587" }, 422);
      }
    }
    const personal = await aiJobsRoute(req, env, { user, reply, dispatch, readArticleURL });
    if (personal) return personal;
    if (path === "/summary-cache") return summaryCacheRoute(req, { sql, reply, user, randomToken });
    if (path === "/me") return reply({ user });
    if (path === "/logout" && req.method === "POST") {
      await sql("DELETE FROM sessions WHERE token_hash=?", await hash(token)).run();
      return reply({ ok: true });
    }
    if (path === "/companies") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
      return reply({ companies: (await sql("SELECT * FROM companies WHERE code=? OR instr(name,?)>0 OR instr(full_name,?)>0 ORDER BY code LIMIT 20", q, q, q).all()).results });
    }
    if (path === "/preview" && req.method === "GET") {
      const code = url.searchParams.get("code");
      if (!/^\d{4,6}$/.test(code || "")) return reply({ error: "\u80A1\u865F\u683C\u5F0F\u932F\u8AA4" }, 400);
      const company = await sql("SELECT * FROM companies WHERE code=?", code).first();
      if (!company) return reply({ error: "\u516C\u53F8\u4E0D\u5B58\u5728" }, 404);
      const feed = new URL("https://news.google.com/rss/search");
      feed.search = new URLSearchParams({ q: `("${company.name}" OR "${company.full_name}" OR "${code}") (site:cna.com.tw OR site:moneydj.com OR site:news.cnyes.com) when:1m`, hl: "zh-TW", gl: "TW", ceid: "TW:zh-Hant" }).toString();
      const response = await fetch(feed, { headers: { "User-Agent": "StockNewsCalendar/2.0" }, signal: AbortSignal.timeout(2e4) });
      if (!response.ok) return reply({ error: "\u65B0\u805E\u4F86\u6E90\u66AB\u6642\u7121\u6CD5\u8B80\u53D6\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66" }, 502);
      const conflicts = (await sql("SELECT name FROM companies WHERE code<>? AND name<>? AND instr(name,?)>0", company.code, company.name, company.name).all()).results.map((x) => x.name);
      return reply({ company, news: parsePreview(await response.text(), company, /* @__PURE__ */ new Date(), conflicts) });
    }
    if (path === "/watchlists" && req.method === "GET") {
      const companies = (await sql("SELECT c.*, (SELECT COUNT(*) FROM news n WHERE n.company_code=c.code) AS news_count FROM companies c JOIN watchlists w ON c.code=w.company_code WHERE w.user_id=? ORDER BY w.created_at,c.code", user.id).all()).results;
      const catalog = (await sql("SELECT code,name FROM companies").all()).results;
      return reply({ companies: companies.map((c) => ({ ...c, conflicting_names: catalog.filter((other) => other.code !== c.code && other.name !== c.name && other.name.includes(c.name)).map((other) => other.name) })) });
    }
    if (path === "/watchlists" && req.method === "POST") {
      const { code } = await req.json();
      if (!await sql("SELECT code FROM companies WHERE code=?", code).first()) return reply({ error: "\u516C\u53F8\u4E0D\u5B58\u5728" }, 404);
      await sql("INSERT OR IGNORE INTO watchlists(user_id,company_code) VALUES(?,?)", user.id, code).run();
      return reply({ ok: true });
    }
    if (path === "/watchlists" && req.method === "DELETE") {
      await sql("DELETE FROM watchlists WHERE user_id=? AND company_code=?", user.id, url.searchParams.get("code")).run();
      return reply({ ok: true });
    }
    if (path === "/news") {
      const from = url.searchParams.get("from"), to = url.searchParams.get("to"), offset = Number(url.searchParams.get("offset") || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isSafeInteger(offset) || offset < 0) return reply({ error: "Invalid range" }, 400);
      return reply({ news: (await sql("SELECT n.* FROM news n JOIN watchlists w ON w.company_code=n.company_code WHERE w.user_id=? AND n.news_date BETWEEN ? AND ? ORDER BY n.published_at DESC,n.id DESC LIMIT 500 OFFSET ?", user.id, from, to, offset).all()).results });
    }
    if ((path === "/collect" || path === "/summarize") && req.method === "POST") {
      const b = await req.json(), type = path.slice(1);
      let code = b.code, news;
      if (type === "summarize") {
        news = await sql("SELECT * FROM news WHERE id=?", b.id).first();
        if (!news) return reply({ error: "\u65B0\u805E\u4E0D\u5B58\u5728" }, 404);
        code = news.company_code;
      }
      if (!await sql("SELECT 1 FROM watchlists WHERE user_id=? AND company_code=?", user.id, code).first()) return reply({ error: "\u5C1A\u672A\u8FFD\u8E64\u6B64\u516C\u53F8" }, 403);
      const retryAI = b.retry_ai === true && news?.summary_method !== "ai";
      if (news?.article_summary && !retryAI) return reply({ news });
      const existing = await sql("SELECT * FROM jobs WHERE type=? AND company_code=? AND news_id IS ? AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1", type, code, news?.id || null).first();
      if (existing) {
        let dispatched2, dispatchError2;
        if (existing.status === "pending") {
          dispatched2 = false;
          try {
            dispatched2 = await dispatch(env);
          } catch (e) {
            dispatchError2 = e.message || "GitHub \u9023\u7DDA\u5931\u6557";
          }
        }
        return reply({ job: existing, news, dispatched: dispatched2, dispatchError: dispatchError2 }, 202);
      }
      const recent = await sql("SELECT * FROM jobs WHERE type=? AND company_code=? AND news_id IS ? AND created_at>? ORDER BY created_at DESC LIMIT 1", type, code, news?.id || null, Date.now() - 15 * 6e4).first();
      if (recent?.status === "done" && !retryAI) return reply({ job: recent, news }, 202);
      const id = randomToken();
      await sql("INSERT OR IGNORE INTO jobs(id,type,company_code,news_id,created_at) VALUES(?,?,?,?,?)", id, type, code, news?.id || null, Date.now()).run();
      const queued = await sql("SELECT id,status FROM jobs WHERE type=? AND company_code=? AND news_id IS ? AND status IN ('pending','running') LIMIT 1", type, code, news?.id || null).first();
      let dispatched = false, dispatchError;
      try {
        dispatched = await dispatch(env);
      } catch (e) {
        dispatchError = e.message || "GitHub \u9023\u7DDA\u5931\u6557";
      }
      return reply({ job: queued, news, dispatched, dispatchError }, 202);
    }
    if (path === "/jobs") {
      const j = await sql("SELECT j.* FROM jobs j JOIN watchlists w ON w.company_code=j.company_code WHERE j.id=? AND w.user_id=?", url.searchParams.get("id"), user.id).first();
      if (!j) return reply({ error: "Job not found" }, 404);
      return reply({ job: j, news: j.news_id ? await sql("SELECT * FROM news WHERE id=?", j.news_id).first() : void 0 });
    }
    return reply({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e.message);
    return reply({ error: "\u670D\u52D9\u66AB\u6642\u7121\u6CD5\u4F7F\u7528\uFF0C\u8ACB\u6AA2\u67E5\u5F8C\u7AEF\u8A2D\u5B9A" }, 500);
  }
} };
export {
  checkedArticleURL,
  companyMention,
  curateNews,
  dailyBars,
  index_default as default,
  duplicateNews,
  extractArticleBody,
  hash,
  isGeneratedAnswer,
  normalizeArticleURL,
  parseCompanyProfile,
  parsePreview,
  randomToken,
  readArticleURL,
  resolveArticleURL,
  sourceDomain,
  trustedSource,
  verifyGoogle
};
