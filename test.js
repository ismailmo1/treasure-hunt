// Quick checks for logic.js and stages.json. Run with: node test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./logic.js");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "stages.json"), "utf8"));
assert.deepStrictEqual(L.validateConfig(config), [], "stages.json should be valid");

// A hunt is a list of places; the last one is only where it ends (nothing to scan there).
const END = { location: { name: "End", lat: 1, lng: 1 } };
const withEnd = (stage) => ({ stages: [stage, END] });

// validation
assert.ok(L.validateConfig(null).length);
assert.ok(L.validateConfig({ stages: [] }).length);
assert.ok(L.validateConfig({ stages: [END] })[0].includes("at least two"), "needs a start and an end");
const bad = L.validateConfig(withEnd({
  clue: "", barcodes: [123], unlockAt: "tomorrow-ish", location: { name: "x", lat: 200, lng: "a" }
}));
assert.strictEqual(bad.length, 5, bad.join("\n"));
assert.ok(bad.every((m) => m.startsWith("Stage 1: ")));
assert.ok(L.validateConfig(withEnd({ clue: "c", barcodes: ["1"] }))[0].includes("location"));

// the last entry needs no clue or barcodes, every other entry does
assert.deepStrictEqual(L.validateConfig({ stages: [{ clue: "c", barcodes: ["1"], location: END.location }, END] }), []);
const noClue = L.validateConfig({ stages: [{ clue: "c", barcodes: ["1"], location: END.location }, { location: END.location }, END] });
assert.strictEqual(noClue.length, 2, noClue.join("\n"));
assert.ok(noClue.every((m) => m.startsWith("Stage 2: ")));
assert.ok(L.validateConfig({ stages: [{ location: END.location }, END] }).length === 2, "first entry needs a clue and barcodes too");

assert.strictEqual(L.validateConfig({ welcome: "", stages: [] }).length, 2);
assert.ok(L.validateConfig(withEnd({ clue: "c", detail: 5, barcodes: ["1"], location: { name: "x", lat: 1, lng: 1 } }))[0].includes("detail"));

// "current" locations have no fixed point
const stageAt = (location) => ({ stages: [{ clue: "c", barcodes: ["1"], location }, END] });
assert.deepStrictEqual(L.validateConfig(stageAt({ name: "Home", current: true })), []);
assert.ok(L.validateConfig(stageAt({ name: "Home", current: "yes" }))[0].includes("current"));
assert.ok(L.validateConfig(stageAt({ name: "Home" })).length === 2, "no current, no lat/lng: still an error");
assert.ok(L.validateConfig(stageAt({ name: "Home", current: false })).length === 2);

assert.ok(L.validateConfig({ overridePassword: "", stages: [] })[0].includes("overridePassword"));

// barcode matching
assert.ok(L.barcodeMatches("5449000000996", ["5449000000996"]));
assert.ok(L.barcodeMatches(" 5449000000996 ", ["111", "5449000000996"]));
assert.ok(L.barcodeMatches("012345678905", ["0012345678905"]), "UPC-A vs EAN-13 leading zero");
assert.ok(L.barcodeMatches("0012345678905", ["012345678905"]));
assert.ok(L.barcodeMatches("5449000000996", [{ code: "5449000000996", note: "Coke 500ml" }]), "{code, note} entries match");
assert.ok(!L.barcodeMatches("5449000000996", [{ note: "no code" }]));
assert.ok(L.validateConfig(withEnd({ clue: "c", barcodes: [{ note: "x" }], location: { name: "x", lat: 1, lng: 1 } }))[0].includes("barcode"));
assert.ok(!L.barcodeMatches("5449000000997", ["5449000000996"]));
assert.ok(!L.barcodeMatches("", ["5449000000996"]));
assert.ok(!L.barcodeMatches("000", ["0"]), "all-zero input never matches");
// entries are prefixes: a full code matches only itself, a shorter one matches that maker's other items
assert.ok(L.barcodeMatches("5000159559485", ["5000159"]), "company prefix matches any product from it");
assert.ok(L.barcodeMatches("5000159559485", [{ code: "5000159", note: "any Mars product" }]));
assert.ok(!L.barcodeMatches("5000328428581", ["5000159"]), "a different maker's prefix doesn't match");
assert.ok(L.barcodeMatches("0847534004384", ["847534"]), "leading zeros ignored on prefixes too");
assert.ok(L.barcodeMatches("847534004384", ["0847534"]));
assert.ok(!L.barcodeMatches("5000159559485", ["5000159559486"]), "a full code only matches itself");
assert.ok(!L.barcodeMatches("5000159", ["5000159559485"]), "a scan shorter than the entry doesn't match");
assert.ok(L.barcodeMatches("00062589", ["00062589"]), "8-digit codes (M&S) match exactly");
assert.ok(!L.barcodeMatches("6258901234567", ["00062589"]), "an 8-digit code with leading zeros is not a prefix");
assert.ok(!L.barcodeMatches("5449000000996", ["", "0"]), "empty or all-zero entries never match everything");
assert.ok(L.validateConfig(withEnd({ clue: "c", barcodes: ["12ab"], location: { name: "x", lat: 1, lng: 1 } }))[0].includes("barcode"), "non-digit entries rejected");

// timer
const now = new Date("2026-12-01T13:00:00").getTime();
assert.strictEqual(L.msUntilUnlock({ unlockAt: "2026-12-01T14:00:00" }, now), 3600000);
assert.strictEqual(L.msUntilUnlock({ unlockAt: "2026-12-01T12:00:00" }, now), 0);
assert.strictEqual(L.msUntilUnlock({}, now), 0);
assert.strictEqual(L.formatCountdown(3600000), "01:00:00");
assert.strictEqual(L.formatCountdown(59001), "00:01:00");
assert.strictEqual(L.formatCountdown(999), "00:00:01");
assert.strictEqual(L.formatCountdown(90061000), "1d 01:01:01");

// distance
const start = { lat: 51.5033, lng: -0.1195 };
assert.strictEqual(Math.round(L.distanceMetres(start, start)), 0);
const oneKm = L.distanceMetres(start, { lat: 51.5033 + 0.009, lng: -0.1195 }); // ~0.009 deg of latitude
assert.ok(oneKm > 990 && oneKm < 1010, "0.009 deg lat is about 1 km, got " + oneKm);
assert.ok(L.distanceMetres({ lat: 55.9533, lng: -3.1883 }, start) > 500000, "London to Edinburgh is far");
assert.ok(L.withinRadius(150, 10, 200));
assert.ok(!L.withinRadius(500, 10, 200));
assert.ok(L.withinRadius(250, 80, 200), "weak fix gets the benefit of the doubt");
assert.ok(!L.withinRadius(500, 5000, 200), "but only up to 100 m of slack");
assert.strictEqual(L.formatDistance(87.4), "87 m");
assert.strictEqual(L.formatDistance(1530), "1.5 km");
assert.strictEqual(L.formatDistance(3000), "3 km");
assert.ok(L.validateConfig({ arrivalRadius: 0, stages: [{ clue: "c", barcodes: ["1"], location: { name: "x", lat: 1, lng: 1, radius: -5 } }, END] }).length === 2);

// what happens after a scan
const hunt = [
  { location: { name: "Home", current: true } },
  { location: { name: "Home", current: true } },
  { location: { name: "Arena", lat: 1, lng: 1 } },
  { location: { name: "Hotel", lat: 2, lng: 2 } }
];
assert.strictEqual(L.afterScan(hunt, 0), "next-clue", "next stage is where you already are");
assert.strictEqual(L.afterScan(hunt, 1), "reveal", "next stage is somewhere else");
assert.strictEqual(L.afterScan(hunt, 2), "reveal", "the final location is revealed like any other");
assert.strictEqual(L.afterScan(hunt, 3), "finish", "a scan past the end");
const endsHere = [{ location: { name: "Home", current: true } }, { location: { name: "Here", current: true } }];
assert.strictEqual(L.afterScan(endsHere, 0), "reveal", "the last location is always revealed, even if it's `current`");

// links
assert.strictEqual(L.formatCoords({ lat: 51.5033, lng: -0.1195 }), "51.5033, -0.1195");
assert.strictEqual(
  L.mapsDirectionsUrl({ lat: 51.5033, lng: -0.1195 }),
  "https://www.google.com/maps/dir/?api=1&destination=51.5033%2C-0.1195&travelmode=driving"
);

console.log("All checks passed.");
