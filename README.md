# Our Addis

A private, local-first memory book for Kaleab & Abigya: every place we go in Addis Ababa, with food and place reviews, star ratings, what we spent, photos, a map of favourites and regulars, stats, the Ethiopian Orthodox fasting calendar, and a fasting-aware "Where should we go next?" powered by Claude with web search.

## How it works

```
 Kaleab's phone ─┐                         ┌──────────── Windows PC (home copy) ────────────┐
 (full offline   │  Tailscale (private,    │ PocketBase  ── data.db + photos                │
  copy in the    ├─ HTTPS, nobody else) ──►│   pb_hooks:  2-account cap, last-edit-wins,    │
  browser)       │                         │              Claude "where next" (key on PC)   │
 Abigya's phone ─┘                         │   backups:   nightly 03:00, 14 kept + Documents│
                                           └────────────────────────────────────────────────┘
```

- **Phones are local-first.** Every visit, review and photo is saved in the phone's own storage (IndexedDB) first, then queued. The app (an installable PWA) opens instantly with no signal and with the PC switched off.
- **Automatic two-way sync** whenever the phone can reach the PC: on opening, on regaining signal, every 45 s while open, and right after each change. Uploads resume after interruptions, without duplicates.
- **Conflicts:** if you both edit the same visit, the edit made last (by the phone's clock) wins everywhere. The PC refuses older edits.
- **Nothing is ever erased on the PC.** Deleting in the app marks the record deleted (it disappears from both phones), but the PC keeps it and can restore it from the dashboard.
- **Private:** the PC only listens on 127.0.0.1. Tailscale exposes it as HTTPS only to devices in your tailnet. Only two accounts can ever exist. Photos need a signed-in token.
- **AI picks** go phone → PC → Claude, so the Anthropic key lives only on the PC (`C:\OurAddis\secrets\anthropic.key`). Limited to 25 a day. Offline picks work anywhere.

## Install on the Windows PC (once)

1. Install **Tailscale** on the PC and on both phones (tailscale.com/download), signed in to the same account. In the Tailscale admin console, under **DNS**, enable **MagicDNS** and **HTTPS certificates**.
2. Download this repo (Code → Download ZIP) and unzip it.
3. Double-click **`server\windows\install.cmd`** and accept the admin prompt. It:
   - downloads PocketBase 0.40.6 (checksum-verified) to `C:\OurAddis`
   - asks for your Anthropic API key (optional; you can rerun later)
   - asks for a dashboard login (PC only: http://127.0.0.1:8090/_/)
   - creates the background task **OurAddis** (starts with Windows, restarts itself) and **OurAddis-Backup**
   - publishes the app over Tailscale and prints the address, e.g. `https://my-pc.tail1234.ts.net/`
4. On each phone, with Tailscale on, open that address. On iPhone: Share → **Add to Home Screen**. On Android: **Install app**. Then tap **Create account** (Kaleab first, then Abigya).

Updating later: download the new version and run `install.cmd` again. Your data is never touched.

## Good to know

- **Away from home:** keep Tailscale on in the background on the phones, and syncing works on mobile data too.
- **First sign-in** needs the PC on. After that, the PC can be off for days.
- **Offline map:** the installer downloads the Addis Ababa map once (OpenStreetMap data via Protomaps, no API key) and each phone keeps its own copy after first opening the map, so it works with no internet and the PC off. Before that, or outside Addis, the online OpenStreetMap map is used. To refresh the map later, delete `C:\OurAddis\maps\addis.pmtiles` and run the installer again.
- **Place search** needs internet.
- **Restore:** backups are full zips (database plus photos) in `C:\OurAddis\pb_data\backups` and `Documents\Our Addis backups`. Restore one from the dashboard → Settings → Backups.
- **Forgot a password:** dashboard → users → edit.

## Layout

- `app/`: the phone app (served by the PC): `store.js` sync engine, `sw.js` offline shell, `fasting.js` calendar
- `server/pb_migrations`: schema, rules, backup schedule
- `server/pb_hooks`: account cap, conflict rule, Claude route
- `server/windows`: installer and uninstaller
