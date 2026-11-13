// Pure helpers: no DOM, so they can also be checked under Node (see test.js).
(function (root) {
  "use strict";

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function isPositiveNumber(v) {
    return typeof v === "number" && isFinite(v) && v > 0;
  }

  // A barcode entry is either the number as text, or {code, note} where note is just a reminder.
  function barcodeCode(b) {
    return b !== null && typeof b === "object" ? b.code : b;
  }

  // Returns a list of human-readable problems; empty means the config is fine.
  function validateConfig(config) {
    var errors = [];
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return ["stages.json must be an object with a \"stages\" list."];
    }
    if (config.welcome !== undefined && !isNonEmptyString(config.welcome)) {
      errors.push("\"welcome\" must be text (or remove it).");
    }
    if (config.overridePassword !== undefined && !isNonEmptyString(config.overridePassword)) {
      errors.push("\"overridePassword\" must be text (or remove it).");
    }
    if (config.arrivalRadius !== undefined && !isPositiveNumber(config.arrivalRadius)) {
      errors.push("\"arrivalRadius\" must be a number of metres greater than 0 (or remove it).");
    }
    if (!Array.isArray(config.stages) || config.stages.length < 2) {
      return errors.concat("\"stages\" must list at least two places: where the hunt starts and where it ends.");
    }
    config.stages.forEach(function (s, i) {
      var label = "Stage " + (i + 1) + ": ";
      if (!s || typeof s !== "object") {
        errors.push(label + "must be an object.");
        return;
      }
      // The last entry is just the final location: there's nothing to scan there, so no clue or barcodes.
      var needsScan = i < config.stages.length - 1;
      if (needsScan && !isNonEmptyString(s.clue)) errors.push(label + "\"clue\" is missing.");
      if (s.detail !== undefined && !isNonEmptyString(s.detail)) {
        errors.push(label + "\"detail\" must be text (or remove it).");
      }
      if (needsScan && (!Array.isArray(s.barcodes) || s.barcodes.length === 0)) {
        errors.push(label + "\"barcodes\" must list at least one barcode.");
      } else if (needsScan) {
        s.barcodes.forEach(function (b) {
          var code = barcodeCode(b);
          if (!isNonEmptyString(code) || !/^[0-9 ]+$/.test(code)) {
            errors.push(label + "each barcode must be digits as text in quotes, e.g. \"5449000000996\", " +
              "or {\"code\": \"5449000000996\", \"note\": \"Coke 500ml\"}.");
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
        if (loc.current !== undefined && typeof loc.current !== "boolean") {
          errors.push(label + "location \"current\" must be true or false (or remove it).");
        }
        // A "current" location has no fixed point: it's wherever the player already is.
        if (loc.current !== true) {
          if (typeof loc.lat !== "number" || loc.lat < -90 || loc.lat > 90) {
            errors.push(label + "location \"lat\" must be a number between -90 and 90.");
          }
          if (typeof loc.lng !== "number" || loc.lng < -180 || loc.lng > 180) {
            errors.push(label + "location \"lng\" must be a number between -180 and 180.");
          }
          if (loc.radius !== undefined && !isPositiveNumber(loc.radius)) {
            errors.push(label + "location \"radius\" must be a number of metres greater than 0 (or remove it).");
          }
        }
      }
    });
    return errors;
  }

  // Strip spaces and leading zeros so a 12-digit UPC matches its 13-digit EAN form.
  function normaliseBarcode(code) {
    return String(code).replace(/\s+/g, "").replace(/^0+/, "");
  }

  // Entries of 8, 12, 13 or 14 digits are full barcodes and must match the scan exactly (after normalising).
  // Anything shorter is a prefix, typically a maker's company prefix, and matches every scan starting with it.
  function isFullBarcode(code) {
    return /^\d{8}$|^\d{12,14}$/.test(String(code).replace(/\s+/g, ""));
  }

  function barcodeMatches(scanned, accepted) {
    var n = normaliseBarcode(scanned);
    if (!n) return false;
    return accepted.some(function (b) {
      var code = barcodeCode(b);
      var entry = normaliseBarcode(code);
      if (entry === "") return false;
      return isFullBarcode(code) ? n === entry : n.indexOf(entry) === 0;
    });
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

  // What happens after the player scans stage `index`'s barcodes (a stage is what to scan at its own
  // location; the scan reveals the next stage's location):
  //   "finish"    - there is no next stage (only possible for a scan past the end)
  //   "next-clue" - the next stage is wherever the player already is, so there's nowhere to reveal
  //   "reveal"    - show where the next stage is; always the case for the last stage, which ends the hunt
  function afterScan(stages, index) {
    var next = stages[index + 1];
    if (!next) return "finish";
    var isLast = index + 1 === stages.length - 1;
    if (!isLast && next.location && next.location.current === true) return "next-clue";
    return "reveal";
  }

  // Great-circle distance in metres between two {lat, lng} points (haversine).
  function distanceMetres(a, b) {
    var R = 6371000;
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Gives the player the benefit of the doubt for a weak GPS fix, but only up to 100 m.
  function withinRadius(distance, accuracy, radius) {
    var slack = Math.min(Math.max(accuracy || 0, 0), 100);
    return distance - slack <= radius;
  }

  function formatDistance(m) {
    return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1).replace(/\.0$/, "") + " km";
  }

  function formatCoords(loc) {
    return loc.lat + ", " + loc.lng;
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
    afterScan: afterScan,
    distanceMetres: distanceMetres,
    withinRadius: withinRadius,
    formatDistance: formatDistance,
    formatCoords: formatCoords,
    mapsDirectionsUrl: mapsDirectionsUrl
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HuntLogic = api;
})(typeof window !== "undefined" ? window : this);
