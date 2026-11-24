/// <reference path="../pb_data/types.d.ts" />
// Our Addis server rules. Each handler runs in its own isolated context, so helpers live inside.

// ---------- only two accounts, ever ----------
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth() && e.app.countRecords("users") >= 2) {
    throw new ForbiddenError("Our Addis is private to the two of us. No new accounts can be created.");
  }
  e.next();
}, "users");

// ---------- who logged it ----------
onRecordCreateRequest((e) => {
  if (e.auth) e.record.set("created_by", e.auth.id);
  if (!e.record.getFloat("client_ts")) e.record.set("client_ts", Date.now());
  e.next();
}, "places", "visits", "photos");

// ---------- last edit wins, by the time it was made on the phone ----------
// A phone that was offline for a week can't overwrite a newer edit made on the other phone.
onRecordUpdateRequest((e) => {
  const incoming = e.record.getFloat("client_ts");
  const current = e.record.original().getFloat("client_ts");
  if (incoming && current && incoming < current) {
    throw new ApiError(409, "stale", { current_client_ts: current });
  }
  e.record.set("created_by", e.record.original().getString("created_by"));
  e.next();
}, "places", "visits", "photos");

// ---------- health check for the app's sync status ----------
routerAdd("GET", "/api/our/ping", (e) => {
  return e.json(200, { ok: true, time: new Date().toISOString() });
});

// ---------- "Where should we go next?" via Claude with web search ----------
routerAdd("POST", "/api/our/recommend", (e) => {
  const DAILY_LIMIT = 25;
  const s = (v, max) => String(v == null ? "" : v).slice(0, max || 200);

  let key = $os.getenv("ANTHROPIC_API_KEY");
  if (!key) {
    try { key = toString($os.readFile(__hooks + "/../secrets/anthropic.key")).trim(); } catch (_) { key = ""; }
  }
  if (!key) return e.json(503, { message: "AI isn't set up on the home PC yet (no Anthropic key).", code: "no_key" });

  const since = new Date(Date.now() - 864e5).toISOString().replace("T", " ");
  const recent = e.app.findRecordsByFilter("recommendations", "created >= {:since}", "", 100, 0, { since: since });
  if (recent.length >= DAILY_LIMIT) return e.json(429, { message: "That's enough recommendations for today. Try again tomorrow.", code: "limit" });

  const body = e.requestInfo().body || {};
  const f = (body.fasting && typeof body.fasting === "object") ? body.fasting : { fasting: false };
  const req = { date: s(body.date, 10), fasting: f, mood: s(body.mood, 80), budget: s(body.budget, 60), area: s(body.area, 60), novelty: s(body.novelty, 20), notes: s(body.notes, 300) };

  // what we already know and like
  const places = e.app.findRecordsByFilter("places", "deleted = false", "", 500, 0);
  const visits = e.app.findRecordsByFilter("visits", "deleted = false", "-visited_on", 500, 0);
  const by = {};
  for (const v of visits) {
    const id = v.getString("place_id");
    const o = by[id] || (by[id] = { n: 0, sum: 0, cnt: 0, spent: 0, last: "" });
    o.n++; if (!o.last) o.last = v.getString("visited_on");
    for (const k of ["r_food", "r_vibe", "r_service", "r_value"]) { const r = v.getFloat(k); if (r) { o.sum += r; o.cnt++; } }
    o.spent += v.getFloat("spent_birr");
  }
  const history = places.map((p) => {
    const o = by[p.id];
    return "- " + p.getString("name") + " (" + (p.getString("area") || "?") + "; " + (p.getString("cuisine") || p.getString("kind")) + ")" +
      (o ? ": " + o.n + " visit(s), avg rating " + (o.cnt ? (o.sum / o.cnt).toFixed(1) : "n/a") + "/5, avg spend " + Math.round(o.spent / o.n) + " birr, last " + o.last
         : (p.getBool("wishlist") ? ": on our want-to-try list" : ": saved"));
  }).join("\n") || "(nothing logged yet)";

  const fastingLine = f.fasting
    ? "Today is a FASTING day in the Ethiopian Orthodox calendar (" + s(f.name, 60) + (f.day ? ", day " + f.day + " of " + f.total : "") + "). Only suggest places with a good fasting (ye tsom, vegan) menu, and say which fasting dishes to order."
    : "Today is not a fasting day (fisk), so any food is fine.";

  const prompt = "You recommend where Kaleab and his girlfriend Abigya should eat or go next in Addis Ababa, Ethiopia.\n\n" +
    "Date: " + req.date + "\n" + fastingLine + "\n" +
    "What they're in the mood for: " + (req.mood || "open to anything") + "\n" +
    "Budget for two: " + (req.budget || "flexible") + "\n" +
    "Area: " + (req.area || "anywhere in Addis") + "\n" +
    "New vs familiar: " + (req.novelty || "mix") + "\n" +
    "Extra notes: " + (req.notes || "none") + "\n\n" +
    "Places they have been or saved:\n" + history + "\n\n" +
    "Use web search to find current, open places in Addis Ababa. Prefer Ethiopian food sources: Sugar Gabata, local food blogs and guides, Google and TripAdvisor reviews, and Addis food creators on TikTok and Instagram. Check that each place still exists and is well reviewed recently. Respect the budget (prices in Ethiopian birr for two people, food plus drinks). When they want \"new\", don't suggest places they've already visited; you may include one favourite if they asked for a mix.\n\n" +
    "Reply with ONLY a JSON object, no other text:\n" +
    "{\"summary\": \"one warm sentence about today's picks\", \"picks\": [{\"name\": \"\", \"area\": \"\", \"type\": \"restaurant|cafe|bar|bakery|park|other\", \"cuisine\": \"\", \"why\": \"2 sentences, personal and specific\", \"order\": \"what to order\", \"est_cost_birr_for_two\": 0, \"fasting_ok\": true, \"new_for_us\": true, \"lat\": 0, \"lng\": 0, \"source_urls\": [\"https://...\"]}]}\n" +
    "Give 4 picks. Use null for lat/lng if you don't know them.";

  const base = $os.getenv("OUR_ADDIS_ANTHROPIC_URL") || "https://api.anthropic.com";
  const messages = [{ role: "user", content: prompt }];
  let resp = null;
  for (let i = 0; i < 4; i++) {
    let res;
    try {
      res = $http.send({
        url: base + "/v1/messages", method: "POST", timeout: 170,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
        body: JSON.stringify({
          model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "medium" }, fallbacks: "default",
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6,
            user_location: { type: "approximate", city: "Addis Ababa", country: "ET", timezone: "Africa/Addis_Ababa" } }],
          messages: messages,
        }),
      });
    } catch (err) {
      return e.json(502, { message: "The home PC couldn't reach Claude. Is it online?", code: "network" });
    }
    if (res.statusCode === 401) return e.json(502, { message: "The Anthropic key on the home PC isn't valid.", code: "bad_key" });
    if (res.statusCode === 429 || res.statusCode === 529) return e.json(503, { message: "Claude is busy right now. Try again in a minute.", code: "busy" });
    if (res.statusCode !== 200) return e.json(502, { message: "Claude error (" + res.statusCode + ").", code: "api" });
    resp = res.json;
    if (resp.stop_reason !== "pause_turn") break;
    messages.length = 1;
    messages.push({ role: "assistant", content: resp.content });
  }
  if (!resp) return e.json(502, { message: "No answer from Claude.", code: "api" });
  if (resp.stop_reason === "refusal") return e.json(422, { message: "Claude couldn't answer that. Try different notes.", code: "refusal" });

  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const searched = [];
  for (const b of resp.content || []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url && searched.indexOf(r.url) < 0) searched.push(r.url);
  }
  let parsed = null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.picks)) return e.json(502, { message: "Claude's answer couldn't be read. Try again.", code: "parse" });

  const result = { summary: String(parsed.summary || ""), picks: parsed.picks.slice(0, 6), searched: searched.slice(0, 12), model: resp.model || "" };
  const rec = new Record(e.app.findCollectionByNameOrId("recommendations"));
  rec.set("request", req); rec.set("result", result); rec.set("created_by", e.auth.id);
  e.app.save(rec);
  return e.json(200, result);
}, $apis.requireAuth("users"));
