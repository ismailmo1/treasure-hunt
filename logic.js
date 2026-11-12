// Pure helpers: no DOM, so they can also be checked under Node (see test.js).
(function (root) {
  "use strict";

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  // Returns a list of human-readable problems; empty means the config is fine.
  function validateConfig(config) {
    var errors = [];
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return ["stages.json must be an object with a \"stages\" list."];
    }
    if (!Array.isArray(config.stages) || config.stages.length === 0) {
      return ["\"stages\" must be a list with at least one stage."];
    }
    config.stages.forEach(function (s, i) {
      var label = "Stage " + (i + 1) + ": ";
      if (!s || typeof s !== "object") {
        errors.push(label + "must be an object.");
        return;
      }
      if (!isNonEmptyString(s.clue)) errors.push(label + "\"clue\" is missing.");
      if (s.searchTerm !== undefined && !isNonEmptyString(s.searchTerm)) {
        errors.push(label + "\"searchTerm\" must be text (or remove it).");
      }
      if (!Array.isArray(s.barcodes) || s.barcodes.length === 0) {
        errors.push(label + "\"barcodes\" must list at least one barcode.");
      } else {
        s.barcodes.forEach(function (b) {
          if (!isNonEmptyString(b)) {
            errors.push(label + "each barcode must be text in quotes, e.g. \"5449000000996\".");
          }
        });
      }
      if (s.unlockAt !== undefined && isNaN(new Date(s.unlockAt).getTime())) {
        errors.push(label + "\"unlockAt\" isn't a valid date-time. Use e.g. \"2026-12-01T14:00:00\".");
      }
      var loc = s.location;
      if (!loc || typeof loc !== "object") {
        errors.push(label + "\"location\" is missing.");
      } else {
        if (!isNonEmptyString(loc.name)) errors.push(label + "location \"name\" is missing.");
        if (typeof loc.lat !== "number" || loc.lat < -90 || loc.lat > 90) {
          errors.push(label + "location \"lat\" must be a number between -90 and 90.");
        }
        if (typeof loc.lng !== "number" || loc.lng < -180 || loc.lng > 180) {
          errors.push(label + "location \"lng\" must be a number between -180 and 180.");
        }
      }
    });
    return errors;
  }

  // Strip spaces and leading zeros so a 12-digit UPC matches its 13-digit EAN form.
  function normaliseBarcode(code) {
    return String(code).replace(/\s+/g, "").replace(/^0+/, "");
  }

  function barcodeMatches(scanned, accepted) {
    var n = normaliseBarcode(scanned);
    if (!n) return false;
    return accepted.some(function (b) { return normaliseBarcode(b) === n; });
  }

  // Milliseconds until the stage unlocks; 0 if it has no timer or is already open.
  function msUntilUnlock(stage, now) {
    if (!stage || !stage.unlockAt) return 0;
    var t = new Date(stage.unlockAt).getTime();
    if (isNaN(t)) return 0;
    return Math.max(0, t - now);
  }

  function formatCountdown(ms) {
    var total = Math.ceil(ms / 1000);
    var d = Math.floor(total / 86400);
    var h = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    var clock = pad(h) + ":" + pad(m) + ":" + pad(s);
    return d > 0 ? d + "d " + clock : clock;
  }

  function formatCoords(loc) {
    return loc.lat + ", " + loc.lng;
  }

  function mapsSearchUrl(term) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(term);
  }

  function mapsDirectionsUrl(loc) {
    return "https://www.google.com/maps/dir/?api=1&destination=" +
      encodeURIComponent(loc.lat + "," + loc.lng) + "&travelmode=driving";
  }

  var api = {
    validateConfig: validateConfig,
    normaliseBarcode: normaliseBarcode,
    barcodeMatches: barcodeMatches,
    msUntilUnlock: msUntilUnlock,
    formatCountdown: formatCountdown,
    formatCoords: formatCoords,
    mapsSearchUrl: mapsSearchUrl,
    mapsDirectionsUrl: mapsDirectionsUrl
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HuntLogic = api;
})(typeof window !== "undefined" ? window : this);
