(function () {
  "use strict";

  var L = window.HuntLogic;
  var STORAGE_KEY = "treasure-hunt-progress";
  var screen = document.getElementById("screen");
  var progressEl = document.getElementById("progress");
  var titleEl = document.getElementById("title");

  var config = null;
  // phase: "welcome" (stage 0 only) | "clue" | "revealed" (stage scanned; the next stage's location is shown)
  var state = { stage: 0, phase: "welcome" };
  var countdownTimer = null;
  var scanner = null;
  var scannerRunning = false;
  var audioCtx = null;
  var geoWatchId = null;
  var geoSlowTimer = null;
  var DEFAULT_RADIUS = 3000; // metres, used when neither the location nor the config sets one
  var skipGeo = new URLSearchParams(location.search).has("nogeo"); // test helper: turns the check off

  // ---------- small DOM helpers ----------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "onclick") node.addEventListener("click", attrs[k]);
      else if (k === "class") node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function stopGeo() {
    if (geoWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
    clearTimeout(geoSlowTimer);
    geoSlowTimer = null;
  }

  function show(nodes) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    stopGeo();
    screen.replaceChildren.apply(screen, nodes.filter(Boolean));
    window.scrollTo(0, 0);
  }

  function link(label, href, primary) {
    return el("a", {
      class: "btn" + (primary ? " primary" : ""),
      href: href, target: "_blank", rel: "noopener", text: label
    });
  }

  // ---------- saved progress ----------

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Number.isInteger(saved.stage) && saved.stage >= 0 &&
        (saved.phase === "welcome" || saved.phase === "clue" || saved.phase === "revealed")) {
        state = { stage: saved.stage, phase: saved.phase };
      }
    } catch (e) { /* no saved progress, or storage unavailable */ }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function go(stage, phase) {
    state = { stage: stage, phase: phase };
    saveState();
    render();
  }

  // ---------- feedback ----------

  function beep(good) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.frequency.value = good ? 880 : 200;
      osc.type = good ? "sine" : "square";
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (good ? 0.35 : 0.25));
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) { /* sound is a nice-to-have */ }
    if (navigator.vibrate) navigator.vibrate(good ? 150 : [60, 60, 60]);
  }

  // ---------- scanner ----------

  function stopScanner() {
    var s = scanner;
    scanner = null;
    if (!s) return Promise.resolve();
    var stopped = scannerRunning ? s.stop() : Promise.resolve();
    scannerRunning = false;
    return stopped.then(function () { s.clear(); }).catch(function () { /* already stopped */ });
  }

  // Builds the camera view + typed-entry fallback. onCode(code) must return true
  // if the code was accepted (stops the camera) or false to keep scanning.
  function scanView(onCode, opts) {
    var wrap = el("div", { id: "reader-wrap" }, [
      el("div", { id: "reader" }),
      el("div", { class: "flash ok" }, [el("div", { class: "mark", text: "✓" }), el("div", { text: "Correct!" })]),
      el("div", { class: "flash no" }, [el("div", { class: "mark", text: "✕" }), el("div", { text: "Not this one" })])
    ]);
    var status = el("p", { class: "status", text: "Starting camera…" });
    var input = el("input", {
      type: "text", inputmode: "numeric", autocomplete: "off",
      placeholder: "Barcode number", "aria-label": "Barcode number"
    });
    var form = el("form", { class: "manual" }, [input, el("button", { type: "submit", text: "Check" })]);
    var manual = el("details", {}, [el("summary", { text: "Camera not working? Type the barcode number" }), form]);

    var done = false;
    var lastCode = null;
    var lastTime = 0;
    var badTimer = null;
    var idleText = "Starting camera\u2026";
    function setIdle(text, isBad) {
      idleText = text;
      status.className = "status" + (isBad ? " bad" : "");
      status.textContent = text;
    }

    function handle(code) {
      if (done) return;
      var now = Date.now();
      // The camera reports the same barcode many times a second; ignore repeats briefly.
      if (code === lastCode && now - lastTime < 2000) return;
      lastCode = code;
      lastTime = now;

      if (onCode(code)) {
        done = true;
        wrap.className = "good";
        status.className = "status";
        status.textContent = "";
        beep(true);
      } else if (!opts.silent) {
        wrap.className = "";
        void wrap.offsetWidth; // restart the shake animation
        wrap.className = "bad";
        status.className = "status bad";
        status.textContent = "That's not it — try another item.";
        beep(false);
        clearTimeout(badTimer);
        badTimer = setTimeout(function () {
          wrap.className = "";
          status.className = "status";
          status.textContent = idleText;
        }, 1500);
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = input.value.trim();
      if (!code) return;
      lastCode = null; // typed entries are always checked
      handle(code);
      input.value = "";
    });

    function start() {
      if (!window.Html5Qrcode) {
        setIdle("Scanner couldn't load. Check your connection, or type the number below.", false);
        manual.open = true;
        return;
      }
      var F = window.Html5QrcodeSupportedFormats;
      scanner = new window.Html5Qrcode("reader", {
        formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.QR_CODE],
        verbose: false
      });
      var mine = scanner;
      mine.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: function (w, h) {
            return { width: Math.floor(w * 0.85), height: Math.floor(Math.min(h * 0.6, w * 0.5)) };
          }
        },
        handle,
        function () { /* no barcode in this frame */ }
      ).then(function () {
        if (scanner !== mine) { // user left the screen while the camera was starting
          mine.stop().then(function () { mine.clear(); }).catch(function () { });
          return;
        }
        scannerRunning = true;
        setIdle("Point the camera at a barcode.", false);
      }).catch(function () {
        if (scanner === mine) scanner = null;
        setIdle(window.isSecureContext
          ? "Couldn't use the camera. Allow camera access, or type the number below."
          : "The camera needs an https:// address. Type the number below instead.", false);
        manual.open = true;
      });
    }

    return { nodes: [wrap, status, manual], start: start };
  }

  // ---------- screens ----------

  function renderHeader() {
    titleEl.textContent = config.title || "Saj's Treasure Hunt";
    document.title = config.title || "Saj's Treasure Hunt";
    var total = config.stages.length - 1; // the last entry is the final location, not a stage to play
    if (state.phase === "welcome") progressEl.textContent = "";
    else progressEl.textContent = state.stage < total ? "Stage " + (state.stage + 1) + " of " + total : "Complete";
  }

  function render() {
    stopScanner();
    renderHeader();
    var n = config.stages.length;
    // The last entry is the final location (nothing to scan there), so reaching it ends the hunt.
    if (state.stage >= n - 1 && state.phase !== "revealed") return renderFinish();
    if (state.stage === 0 && state.phase === "welcome") return renderWelcome();
    var stage = config.stages[state.stage];
    if (state.phase === "revealed") {
      // "revealed" means this stage was scanned and the next stage's location is on show.
      if (L.afterScan(config.stages, state.stage) !== "reveal") return go(state.stage + 1, "clue");
      return renderRevealed(config.stages[state.stage + 1]);
    }
    if (L.msUntilUnlock(stage, Date.now()) > 0) return renderLocked(stage);
    renderClue(stage);
  }

  function renderWelcome() {
    show([
      el("div", { class: "card center" }, [
        el("p", { class: "eyebrow", text: "Welcome" }),
        el("p", { class: "big", text: config.title || "Saj's Treasure Hunt" }),
        el("p", {
          class: "muted",
          text: config.welcome || "Follow the clues, scan the right items, and find your way to the treasure."
        })
      ]),
      el("div", { class: "stack" }, [
        el("button", { class: "primary", text: "Start the treasure hunt", onclick: function () { go(0, "clue"); } })
      ])
    ]);
  }

  function renderLocked(stage) {
    var clock = el("p", { class: "countdown" });
    function tick() {
      var ms = L.msUntilUnlock(stage, Date.now());
      if (ms <= 0) return render();
      clock.textContent = L.formatCountdown(ms);
    }
    show([
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: "Locked" }),
        el("p", { class: "big", text: "The next clue unlocks in" }),
        clock,
        el("p", { class: "muted", text: "Opens " + new Date(stage.unlockAt).toLocaleString([], { dateStyle: "full", timeStyle: "short" }) })
      ])
    ]);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function renderClue(stage) {
    show([
      el("div", { class: "card center" }, [
        el("p", { class: "eyebrow", text: "Find and scan" }),
        el("p", { class: "big", text: stage.clue }),
        el("p", {
          class: "muted",
          text: stage.detail || "Find the item, then scan its barcode to reveal where to go next."
        })
      ]),
      el("div", { class: "stack" }, [
        el("button", { class: "primary", text: "Scan the item", onclick: function () { renderScan(stage); } })
      ])
    ]);
  }

  function renderScan(stage) {
    var index = state.stage;
    var view = scanView(function (code) {
      if (!L.barcodeMatches(code, stage.barcodes)) return false;
      setTimeout(function () {
        stopScanner().then(function () {
          if (L.afterScan(config.stages, index) === "reveal") go(index, "revealed");
          else go(index + 1, "clue"); // nothing to reveal: next clue, or the finish screen after the last stage
        });
      }, 1100); // leave the green tick on screen for a moment
      return true;
    }, {});
    show([
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: "Scanning for" }),
        el("p", { class: "big", text: stage.clue })
      ])
    ].concat(view.nodes, [
      el("div", { class: "stack" }, [el("button", { text: "Back to clue", onclick: render })])
    ]));
    view.start();
  }

  function copyButton(text, label) {
    var btn = el("button", { text: label });
    btn.addEventListener("click", function () {
      copyText(text).then(function (ok) {
        btn.textContent = ok ? "Copied ✓" : "Press and hold the coordinates to copy";
        setTimeout(function () { btn.textContent = label; }, 2500);
      });
    });
    return btn;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, legacyCopy);
    }
    return Promise.resolve(legacyCopy());

    function legacyCopy() {
      try {
        var ta = el("textarea", { readonly: "", style: "position:fixed;top:0;left:0;opacity:0" });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e) { return false; }
    }
  }

  // Keeps `next` disabled until the phone is within `radius` metres of `loc`. If the check
  // can't run (no GPS API, insecure page, permission refused) the player is let through
  // rather than getting stuck.
  function watchArrival(loc, radius, next, status, skip) {
    function allow(message) {
      stopGeo();
      skip.hidden = true;
      status.textContent = message;
      next.disabled = false;
    }
    if (skipGeo) return allow("Location check is off.");
    if (!navigator.geolocation || !window.isSecureContext) {
      return allow("Can't check your location on this connection, so you can carry on.");
    }
    next.disabled = true;
    status.textContent = "Finding your location…";
    // With no fix at all after a while, offer a way past so a bad GPS signal can't end the hunt.
    geoSlowTimer = setTimeout(function () { skip.hidden = false; }, 30000);
    geoWatchId = navigator.geolocation.watchPosition(function (pos) {
      clearTimeout(geoSlowTimer);
      skip.hidden = true;
      var d = L.distanceMetres({ lat: pos.coords.latitude, lng: pos.coords.longitude }, loc);
      if (L.withinRadius(d, pos.coords.accuracy, radius)) return allow("You've arrived ✓");
      status.textContent = "You're " + L.formatDistance(d) + " away. Get within " + L.formatDistance(radius) + " to continue.";
    }, function (err) {
      if (err.code === 1) allow("Location access is off, so you can carry on without the check.");
      // Other errors (no signal yet, timeouts) are retried by the watch.
    }, { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }); // a rough fix is enough
  }

  // Shows where the next stage is (`stage` is that next stage, not the one just scanned).
  function renderRevealed(stage) {
    var isFinal = state.stage + 1 === config.stages.length - 1; // `stage` is the final location
    var coords = L.formatCoords(stage.location);
    var radius = stage.location.radius || config.arrivalRadius || DEFAULT_RADIUS;
    var status = el("p", { class: "status" });
    var next = el("button", {
      class: "primary",
      text: isFinal ? "Finish" : "Next clue",
      onclick: function () { go(state.stage + 1, "clue"); }
    });
    // Escape hatch for a dead GPS signal. If the config sets "overridePassword", it has to be typed first.
    function carryOn() { go(state.stage + 1, "clue"); }
    var passInput = el("input", {
      type: "password", autocomplete: "off", placeholder: "Password", "aria-label": "Password"
    });
    var passError = el("p", { class: "status bad" });
    var passForm = el("form", { class: "manual", hidden: "" }, [
      passInput, el("button", { type: "submit", text: "Continue" })
    ]);
    passForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (passInput.value === config.overridePassword) return carryOn();
      passError.textContent = "That's not the password.";
      passInput.select();
    });
    var skipButton = el("button", {
      text: "Can't get a location? Carry on anyway",
      onclick: function () {
        if (!config.overridePassword) return carryOn();
        skipButton.hidden = true;
        passForm.hidden = false;
        passInput.focus();
      }
    });
    var skip = el("div", { class: "stack", hidden: "" }, [skipButton, passForm, passError]); // shown by watchArrival
    show([
      el("div", { class: "card center" }, [
        el("p", { class: "eyebrow", text: isFinal ? "Final location" : "To unlock the next clue, go to:" }),
        el("p", { class: "big", text: stage.location.name }),
        el("p", { class: "coords", text: coords })
      ]),
      el("div", { class: "stack" }, [
        copyButton(coords, "Copy coordinates"),
        link("Navigate in Google Maps", L.mapsDirectionsUrl(stage.location), false),
        status,
        next,
        skip
      ])
    ]);
    watchArrival(stage.location, radius, next, status, skip);
  }

  // Brown balloons drifting up the screen. Purely decorative, and hidden for reduced-motion users in CSS.
  function balloons(count) {
    var layer = el("div", { class: "balloons", "aria-hidden": "true" });
    for (var i = 0; i < count; i++) {
      var size = 44 + Math.round(Math.random() * 32);
      var dur = 8 + Math.random() * 6;
      var style = "--x:" + (4 + Math.round(Math.random() * 88)) + "%;" +
        "--size:" + size + "px;" +
        "--dur:" + dur.toFixed(1) + "s;" +
        "--delay:-" + (Math.random() * dur).toFixed(1) + "s;" + // negative: already part-way up when the screen opens
        "--sway:" + (2.2 + Math.random() * 1.8).toFixed(1) + "s";
      layer.appendChild(el("div", { class: "balloon", style: style }, [el("div", { class: "balloon-body" })]));
    }
    return layer;
  }

  function renderFinish() {
    // Shown once the player has reached the final location.
    show([
      el("div", { class: "card center" }, [
        el("p", { class: "eyebrow", text: "Hunt complete" }),
        el("p", { class: "big", text: config.finishMessage || "You made it!" })
      ]),
      balloons(14)
    ]);
  }

  // Setup mode (?setup): scan anything and read off its barcode number.
  function renderSetup() {
    titleEl.textContent = "Setup mode";
    progressEl.textContent = "";
    var result = el("p", { class: "coords", text: "—" });
    var copySlot = el("div");
    var view = scanView(function (code) {
      result.textContent = code;
      copySlot.replaceChildren(copyButton(code, "Copy barcode"));
      beep(true);
      return false; // keep scanning
    }, { silent: true });
    show([
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: "Last barcode scanned" }),
        result,
        el("p", { class: "muted", text: "Add this number, in quotes, to a stage's \"barcodes\" list in stages.json." })
      ])
    ].concat(view.nodes, [
      el("div", { class: "stack" }, [copySlot, link("Back to the hunt", location.pathname, false)])
    ]));
    view.start();
  }

  function renderError(heading, messages) {
    progressEl.textContent = "";
    show([
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: "Problem with stages.json" }),
        el("p", { class: "big", text: heading }),
        el("ul", { class: "errors" }, messages.map(function (m) { return el("li", { text: m }); }))
      ])
    ]);
  }

  // ---------- start-up ----------

  function applyQueryParams() {
    var params = new URLSearchParams(location.search);
    if (params.has("reset")) {
      state = { stage: 0, phase: "welcome" };
      saveState();
    }
    if (params.has("stage")) {
      var n = parseInt(params.get("stage"), 10);
      if (n >= 1 && n <= config.stages.length) {
        state = { stage: n - 1, phase: "clue" };
        saveState();
      }
    }
    if (params.has("reset") || params.has("stage")) {
      history.replaceState(null, "", location.pathname + (params.has("setup") ? "?setup" : ""));
    }
    return params.has("setup");
  }

  function init() {
    fetch("stages.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("stages.json could not be loaded (HTTP " + res.status + ").");
        return res.text();
      })
      .then(function (text) {
        try { return JSON.parse(text); }
        catch (e) { throw new Error("stages.json isn't valid JSON: " + e.message); }
      })
      .then(function (data) {
        var errors = L.validateConfig(data);
        if (errors.length) return renderError("Fix these and refresh", errors);
        config = data;
        loadState();
        if (state.stage > config.stages.length) state = { stage: config.stages.length, phase: "clue" };
        if (applyQueryParams()) renderSetup();
        else render();
      })
      .catch(function (err) {
        var msg = location.protocol === "file:"
          ? "This page was opened as a file. Run a local server instead (see the README)."
          : err.message;
        renderError("Couldn't load the hunt", [msg]);
      });
  }

  // Re-check a countdown when the player comes back from another app.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && countdownTimer) render();
  });

  init();
})();
