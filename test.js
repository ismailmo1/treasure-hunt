// Quick checks for logic.js and stages.json. Run with: node test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./logic.js");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "stages.json"), "utf8"));
assert.deepStrictEqual(L.validateConfig(config), [], "stages.json should be valid");

// validation
assert.ok(L.validateConfig(null).length);
assert.ok(L.validateConfig({ stages: [] }).length);
const bad = L.validateConfig({
  stages: [{ clue: "", barcodes: [123], unlockAt: "tomorrow-ish", location: { name: "x", lat: 200, lng: "a" } }]
});
assert.strictEqual(bad.length, 5, bad.join("\n"));
assert.ok(bad.every((m) => m.startsWith("Stage 1: ")));
assert.ok(L.validateConfig({ stages: [{ clue: "c", barcodes: ["1"] }] })[0].includes("location"));

// barcode matching
assert.ok(L.barcodeMatches("5449000000996", ["5449000000996"]));
assert.ok(L.barcodeMatches(" 5449000000996 ", ["111", "5449000000996"]));
assert.ok(L.barcodeMatches("012345678905", ["0012345678905"]), "UPC-A vs EAN-13 leading zero");
assert.ok(L.barcodeMatches("0012345678905", ["012345678905"]));
assert.ok(!L.barcodeMatches("5449000000997", ["5449000000996"]));
assert.ok(!L.barcodeMatches("", ["5449000000996"]));
assert.ok(!L.barcodeMatches("000", ["0"]), "all-zero input never matches");

// timer
const now = new Date("2026-12-01T13:00:00").getTime();
assert.strictEqual(L.msUntilUnlock({ unlockAt: "2026-12-01T14:00:00" }, now), 3600000);
assert.strictEqual(L.msUntilUnlock({ unlockAt: "2026-12-01T12:00:00" }, now), 0);
assert.strictEqual(L.msUntilUnlock({}, now), 0);
assert.strictEqual(L.formatCountdown(3600000), "01:00:00");
assert.strictEqual(L.formatCountdown(59001), "00:01:00");
assert.strictEqual(L.formatCountdown(999), "00:00:01");
assert.strictEqual(L.formatCountdown(90061000), "1d 01:01:01");

// links
assert.strictEqual(L.formatCoords({ lat: 51.5033, lng: -0.1195 }), "51.5033, -0.1195");
assert.strictEqual(L.mapsSearchUrl("sweet shop"), "https://www.google.com/maps/search/?api=1&query=sweet%20shop");
assert.strictEqual(
  L.mapsDirectionsUrl({ lat: 51.5033, lng: -0.1195 }),
  "https://www.google.com/maps/dir/?api=1&destination=51.5033%2C-0.1195&travelmode=driving"
);

console.log("All checks passed.");
