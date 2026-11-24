// "Where should we go next?" — asks Claude (with web search) for places in Addis Ababa.
// Only the two members can call it. Needs the ANTHROPIC_API_KEY secret.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DAILY_LIMIT = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } });

  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return json({ error: "Please sign in." }, 401);
  const { data: member } = await userDb.rpc("is_member");
  if (member !== true) return json({ error: "This app is private." }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI is not set up yet (missing ANTHROPIC_API_KEY).", code: "no_key" }, 503);

  const admin = createClient(url, service);
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from("recommendations").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: "That's enough recommendations for today. Try again tomorrow.", code: "limit" }, 429);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const s = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
  const reqInfo = {
    date: s(body.date, 10),
    fasting: body.fasting && typeof body.fasting === "object" ? body.fasting : { fasting: false },
    mood: s(body.mood, 80), budget: s(body.budget, 60), area: s(body.area, 60),
    novelty: s(body.novelty, 20), notes: s(body.notes, 300),
  };

  // What the couple already knows and likes
  const { data: places } = await userDb.from("places").select("id,name,area,cuisine,kind,fasting_friendly,wishlist");
  const { data: visits } = await userDb.from("visits").select("place_id,visited_on,r_food,r_vibe,r_service,r_value,spent_birr,ordered").order("visited_on", { ascending: false }).limit(200);
  const byPlace = new Map<string, { n: number; sum: number; cnt: number; spent: number; last: string }>();
  for (const v of visits ?? []) {
    const o = byPlace.get(v.place_id) ?? { n: 0, sum: 0, cnt: 0, spent: 0, last: "" };
    o.n++; o.last = o.last || v.visited_on;
    for (const r of [v.r_food, v.r_vibe, v.r_service, v.r_value]) if (r) { o.sum += r; o.cnt++; }
    o.spent += Number(v.spent_birr || 0);
    byPlace.set(v.place_id, o);
  }
  const history = (places ?? []).map((p) => {
    const o = byPlace.get(p.id);
    return `- ${p.name} (${p.area || "?"}; ${p.cuisine || p.kind})` +
      (o ? `: ${o.n} visit(s), avg rating ${o.cnt ? (o.sum / o.cnt).toFixed(1) : "n/a"}/5, avg spend ${Math.round(o.spent / o.n)} birr, last ${o.last}` : p.wishlist ? ": on our want-to-try list" : ": saved");
  }).join("\n") || "(nothing logged yet)";

  const f = reqInfo.fasting as Record<string, unknown>;
  const fastingLine = f.fasting
    ? `Today is a FASTING day in the Ethiopian Orthodox calendar (${s(f.name, 60)}${f.day ? `, day ${f.day} of ${f.total}` : ""}). Only suggest places with a good fasting (ye tsom, vegan) menu, and say which fasting dishes to order.`
    : `Today is not a fasting day (fisk), so any food is fine.`;

  const prompt = `You recommend where Kaleab and his girlfriend Abigya should eat or go next in Addis Ababa, Ethiopia.

Date: ${reqInfo.date}
${fastingLine}
What they're in the mood for: ${reqInfo.mood || "open to anything"}
Budget for two: ${reqInfo.budget || "flexible"}
Area: ${reqInfo.area || "anywhere in Addis"}
New vs familiar: ${reqInfo.novelty || "mix"}
Extra notes: ${reqInfo.notes || "none"}

Places they have been or saved:
${history}

Use web search to find current, open places in Addis Ababa. Prefer Ethiopian food sources: Sugar Gabata, local food blogs and guides, Google and TripAdvisor reviews, and Addis food creators on TikTok and Instagram. Check that each place still exists and is well reviewed recently. Respect the budget (prices in Ethiopian birr for two people, food plus drinks). When they want "new", don't suggest places they've already visited; you may include one favourite if they asked for a mix.

Reply with ONLY a JSON object, no other text:
{"summary": "one warm sentence about today's picks",
 "picks": [{"name": "", "area": "", "type": "restaurant|cafe|bar|bakery|park|other", "cuisine": "", "why": "2 sentences, personal and specific", "order": "what to order", "est_cost_birr_for_two": 0, "fasting_ok": true, "new_for_us": true, "lat": 0, "lng": 0, "source_urls": ["https://..."]}]}
Give 4 picks. Use null for lat/lng if you don't know them.`;

  const client = new Anthropic({ apiKey });
  const tools = [{
    type: "web_search_20260209", name: "web_search", max_uses: 6,
    user_location: { type: "approximate", city: "Addis Ababa", country: "ET", timezone: "Africa/Addis_Ababa" },
  }];
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "user", content: prompt }];

  // deno-lint-ignore no-explicit-any
  let resp: any = null;
  try {
    for (let i = 0; i < 4; i++) {
      resp = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        // deno-lint-ignore no-explicit-any
        fallbacks: "default" as any,
        // deno-lint-ignore no-explicit-any
        tools: tools as any,
        messages,
      });
      if (resp.stop_reason !== "pause_turn") break;
      messages.splice(1); // keep the original user turn, resume from the paused assistant turn
      messages.push({ role: "assistant", content: resp.content });
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key is not valid.", code: "bad_key" }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute.", code: "busy" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude error (${e.status}).`, code: "api" }, 502);
    return json({ error: "Couldn't reach Claude.", code: "network" }, 502);
  }
  if (!resp) return json({ error: "No answer from Claude." }, 502);
  if (resp.stop_reason === "refusal") return json({ error: "Claude couldn't answer that request. Try different notes.", code: "refusal" }, 422);

  // deno-lint-ignore no-explicit-any
  const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const found: string[] = [];
  for (const b of resp.content) {
    if (b.type === "web_search_tool_result" && Array.isArray((b as { content: unknown }).content)) {
      for (const r of (b as { content: { url?: string }[] }).content) if (r.url) found.push(r.url);
    }
  }
  let parsed: { summary?: string; picks?: unknown[] } | null = null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.picks)) return json({ error: "Claude's answer couldn't be read. Try again.", code: "parse", raw: text.slice(0, 2000) }, 502);

  const result = { summary: String(parsed.summary ?? ""), picks: parsed.picks.slice(0, 6), searched: [...new Set(found)].slice(0, 12), model: resp.model };
  await admin.from("recommendations").insert({ request: reqInfo, result, created_by: u.user.id });
  return json(result);
});
