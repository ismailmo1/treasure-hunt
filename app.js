(function () {
  "use strict";

  var L = window.HuntLogic;
  var STORAGE_KEY = "treasure-hunt-progress";
  var screen = document.getElementById("screen");
  var progressEl = document.getElementById("progress");
  var titleEl = document.getElementById("title");

  var config = null;
  var state = { stage: 0, phase: "clue" }; // phase: "clue" | "revealed"
  var countdownTimer = null;
  var scanner = null;
  var scannerRunning = false;
  var audioCtx = null;

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

  function show(nodes) {
    clearInterval(countdownTimer);
    countdownTimer = null;
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
          (saved.phase === "clue" || saved.phase === "revealed")) {
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
          mine.stop().then(function () { mine.clear(); }).catch(function () {});
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
    titleEl.textContent = config.title || "Treasure Hunt";
    document.title = config.title || "Treasure Hunt";
    var n = config.stages.length;
    progressEl.textContent = state.stage < n ? "Stage " + (state.stage + 1) + " of " + n : "Complete";
  }

  function render() {
    stopScanner();
    renderHeader();
    var n = config.stages.length;
    if (state.stage >= n) return renderFinish();
    var stage = config.stages[state.stage];
    if (state.phase === "revealed") return renderRevealed(stage);
    if (L.msUntilUnlock(stage, Date.now()) > 0) return renderLocked(stage);
    renderClue(stage);
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
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: "Find and scan" }),
        el("p", { class: "big", text: stage.clue }),
        el("p", { class: "muted", text: "Find the item, then scan its barcode to reveal where to go next." })
      ]),
      el("div", { class: "stack" }, [
        stage.searchTerm ? link("Find " + stage.searchTerm + " nearby", L.mapsSearchUrl(stage.searchTerm), false) : null,
        el("button", { class: "primary", text: "Scan the item", onclick: function () { renderScan(stage); } })
      ])
    ]);
  }

  function renderScan(stage) {
    var index = state.stage;
    var view = scanView(function (code) {
      if (!L.barcodeMatches(code, stage.barcodes)) return false;
      setTimeout(function () {
        stopScanner().then(function () { go(index, "revealed"); });
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

  function renderRevealed(stage) {
    var isLast = state.stage === config.stages.length - 1;
    var coords = L.formatCoords(stage.location);
    show([
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: isLast ? "Final location" : "Next location" }),
        el("p", { class: "big", text: stage.location.name }),
        el("p", { class: "coords", text: coords })
      ]),
      el("div", { class: "stack" }, [
        copyButton(coords, "Copy coordinates"),
        link("Navigate in Google Maps", L.mapsDirectionsUrl(stage.location), false),
        el("button", {
          class: "primary",
          text: isLast ? "Finish" : "Next clue",
          onclick: function () { go(state.stage + 1, "clue"); }
        })
      ])
    ]);
  }

  function renderFinish() {
    var last = config.stages[config.stages.length - 1];
    show([
      el("div", { class: "card" }, [
        el("p", { class: "eyebrow", text: "Hunt complete" }),
        el("p", { class: "big", text: config.finishMessage || "You made it!" }),
        el("p", { class: "muted", text: last.location.name }),
        el("p", { class: "coords", text: L.formatCoords(last.location) })
      ]),
      el("div", { class: "stack" }, [
        link("Navigate in Google Maps", L.mapsDirectionsUrl(last.location), false)
      ])
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
      state = { stage: 0, phase: "clue" };
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
