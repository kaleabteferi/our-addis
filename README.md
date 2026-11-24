# Our Addis

A private memory book for Kaleab & Abigya: every place we go in Addis Ababa, with food and place reviews, star ratings, what we spent, photos, a map of our favourites and regulars, stats, and a fasting-aware "Where should we go next?" powered by Claude with web search.

- **Frontend:** plain HTML/JS on GitHub Pages (no build step). Leaflet + OpenStreetMap/CARTO tiles; place search via OpenStreetMap Nominatim.
- **Backend:** Supabase. Postgres with row-level security, a private photo bucket, email/password sign-in, and an edge function (`recommend`) that calls Claude.
- **Privacy:** only the first two accounts that sign up become members. Every table and every photo is readable only by members. Photos are served through short-lived signed links.
- **Fasting calendar:** computed in `fasting.js` (Fasika, Nineveh, Abiy Tsom, Hawaryat, Filseta, Nebiyat, Gahad, Wednesdays/Fridays, with the usual exemptions) plus the Ethiopian date.
- **Demo mode:** with `config.js` empty, the app runs entirely in the browser so you can try it.

## Setup

1. **Supabase project:** create one (free plan is fine), then run `supabase/migrations/001_init.sql` in the SQL editor (or apply it as a migration).
2. **Auth:** in Authentication → URL Configuration, set *Site URL* to the GitHub Pages address, e.g. `https://<user>.github.io/our-addis/`.
3. **AI:** deploy `supabase/functions/recommend` and add the edge-function secret `ANTHROPIC_API_KEY`.
4. **Connect the app:** put the project URL and anon (publishable) key in `config.js`.
5. **Host:** turn on GitHub Pages (Settings → Pages → deploy from this branch, `/ (root)`).
6. Both of you open the site and choose **Create account**. After the two of you have signed up, nobody else can join.

The recommend function is limited to 25 calls a day. Each call costs a few US cents of Claude usage.
