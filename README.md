# [treasurehunt.ismailmo.com](https://treasurehunt.ismailmo.com)

A mobile treasure hunt with no backend. The hunt is a list of places. At each place the player gets a
clue, scans the barcode of the right item, and a correct scan reveals the next place. The player starts
at the first place, so it is never announced, and the hunt ends when the last place is reached.

## Editing the hunt

Everything lives in [`stages.json`](./stages.json):

```json
{
  "title": "Treasure Hunt",
  "welcome": "Follow the clues and find the treasure.",
  "finishMessage": "You made it!",
  "stages": [
    {
      "clue": "Your favourite drink",
      "detail": "Any size will do.",
      "barcodes": ["5449000000996"],
      "unlockAt": "2026-12-01T14:00:00",
      "location": { "name": "Home", "current": true }
    },
    {
      "location": { "name": "The old bandstand", "lat": 51.5033, "lng": -0.1195 }
    }
  ]
}
```

That is a two-place hunt: scan a drink at home, which reveals the bandstand. The last entry is only
where the hunt ends, so it needs a `location` and nothing else. Every entry before it also needs:

| Field | Required | Notes |
|---|---|---|
| `clue` | yes, except on the last entry | The prompt shown to the player at this place. |
| `detail` | no | Extra hint shown under the clue on the clue page (hidden on the scan page). |
| `barcodes` | yes, except on the last entry | What has to be scanned at this place, as text in quotes. A scan counts as correct if it **starts with** any entry, so a full barcode (8, 12, 13 or 14 digits) matches only that item, while a shorter entry (the maker's company prefix, e.g. `5000159` for Mars) matches everything that maker sells. M&S barcodes are 8 digits with no maker prefix, so list them in full. Use a prefix to avoid listing every size/flavour; use full codes where a prefix would be too broad. An entry can also be `{ "code": "…", "note": "Coke 500ml" }`; the note is only a reminder for you. Run `node verify-barcodes.mjs` to look full codes up on Open Food Facts. |
| `unlockAt` | no | The stage stays locked, with a countdown, until this date-time (phone's local time): neither its location nor its clue is shown before then. |
| `location` | yes | Where this place is: `name`, `lat`, `lng`, and an optional `radius` in metres. It's revealed after the *previous* place's scan. For somewhere the player already is, or that you'd rather not publish (like home), use `{ "name": "Home", "current": true }` instead: no coordinates, and the reveal screen before this place is skipped (except for the last entry, which is always revealed). |

At least two entries are needed: where the hunt starts and where it ends. After the scan at the
second-to-last place the final location is revealed; once the player gets there and taps **Finish**,
the `finishMessage` is shown.

### Arrival check

On the reveal screen, **Next clue** (**Finish** for the last place) stays greyed out until the phone is
within 3 km of the revealed location. Change the default with a top-level `"arrivalRadius"` (metres), or
override it for one stage with `"radius"` inside that stage's `location`. The check asks for a rough
location only (cheaper on battery, works indoors), and a weak fix gets up to 100 m of slack.

The check never traps a player: if location access is refused, or the page isn't on `https://`
(or `localhost`), they're let through. If no GPS fix arrives within 30 seconds, a
"Carry on anyway" button appears. If the top-level `"overridePassword"` is set, tapping it asks for that
password first (leave it out to let anyone through). The password sits in `stages.json`, so anyone who
opens that file can read it; it stops accidental skips, not a determined player.

Mistakes in the file show up as a readable error on the page.

## Test helpers

- `?setup` – scan any item to see its barcode number (for filling in `barcodes`).
- `?stage=2` – jump to the clue at the 2nd place (the last number shows the finish message).
- `?reset` – clear saved progress (use it after changing how stages are laid out).
- `?nogeo` – turn the arrival check off (for testing away from the locations).

## Running locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly as a file won't work.

The camera only works on `localhost` or an `https://` address. To scan from a phone
against your laptop, add a tunnel and open the `https://` address it prints:

```sh
cloudflared tunnel --url http://localhost:8000
```

Without HTTPS you can still test everything else by typing barcode numbers.

Logic checks: `node test.js`

## Deploying

GitHub Pages serves the `main` branch root; every push is live. The `CNAME` file sets
the custom domain, which needs a DNS `CNAME` record for `treasurehunt` pointing at
`ismailmo1.github.io`.
