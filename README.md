# [treasurehunt.ismailmo.com](https://treasurehunt.ismailmo.com)

A mobile treasure hunt with no backend. Each stage shows a clue, the player scans the
barcode of the right item, and a correct scan reveals the coordinates of the next location.

## Editing the hunt

Everything lives in [`stages.json`](./stages.json):

```json
{
  "title": "Treasure Hunt",
  "finishMessage": "You made it!",
  "stages": [
    {
      "clue": "Your favourite drink",
      "searchTerm": "supermarket",
      "barcodes": ["5449000000996"],
      "unlockAt": "2026-12-01T14:00:00",
      "location": { "name": "The old bandstand", "lat": 51.5033, "lng": -0.1195 }
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `clue` | yes | The prompt shown to the player. |
| `searchTerm` | no | Adds a "Find … nearby" button that searches Google Maps. |
| `barcodes` | yes | Every barcode that counts as correct, as text in quotes. List each size/pack variant. |
| `unlockAt` | no | The clue stays locked, with a countdown, until this date-time (phone's local time). |
| `location` | yes | Revealed after a correct scan: `name`, `lat`, `lng`. |

Mistakes in the file show up as a readable error on the page.

## Test helpers

- `?setup` – scan any item to see its barcode number (for filling in `barcodes`).
- `?stage=2` – jump to a stage.
- `?reset` – clear saved progress.

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
