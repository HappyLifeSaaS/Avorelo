/*
 * Avorelo "Start with AI" activation CTA (browser + Node).
 *
 * PostHog-Wizard pattern: the visible/copied user input is ONE short command.
 * The robust logic lives behind the CLI (`npx avorelo@latest activate`):
 * detection, plan, safe activation, self-healing repair, diagnostics, proof,
 * and a redacted support fallback. This module is the single source of truth
 * for the copied command and the surrounding copy, shared by the landing hero,
 * the Learn More page, and the dashboard Support setup card.
 *
 * No giant prompt is exposed by default.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AvoreloActivate = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The one short command users copy. Truthful: avorelo is published on npm.
  var ACTIVATE_COMMAND = "npx avorelo@latest activate";

  var HELPER_TEXT =
    "Paste this into Claude Code, Cursor, Codex, or your AI coding tool from your project root.";

  // Truthful safety/status note. The package is published; activation runs
  // locally and detects the project before making changes.
  var STATUS_NOTE =
    "Published on npm. Runs locally, detects your project first, and makes no commits.";

  var LEARN_MORE_URL = "learn-more.html";
  var COPIED_LABEL = "Copied";

  // Resilient clipboard copy with a manual-selection fallback. Returns a
  // Promise<boolean> (true = copied to clipboard, false = use manual fallback).
  function copyCommand(text, selectEl) {
    var value = typeof text === "string" ? text : ACTIVATE_COMMAND;
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(
        function () { return true; },
        function () { return legacyCopy(value, selectEl); }
      );
    }
    return Promise.resolve(legacyCopy(value, selectEl));
  }

  function legacyCopy(value, selectEl) {
    if (typeof document === "undefined") return false;
    try {
      var el = selectEl;
      var temporary = false;
      if (!el) {
        el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        temporary = true;
      } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.focus();
        el.select();
      } else {
        // Non-input element: select its text node range.
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      if (el.select) { el.focus(); el.select(); }
      var ok = document.execCommand && document.execCommand("copy");
      if (temporary) document.body.removeChild(el);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  // Wire every element marked data-copy-activate. Each button copies the
  // command, flashes a Copied state with no layout shift, and on clipboard
  // failure selects the visible command and shows a fallback message.
  function wire(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var buttons = doc.querySelectorAll("[data-copy-activate]");
    Array.prototype.forEach.call(buttons, function (btn) {
      if (btn.getAttribute("data-activate-bound") === "1") return;
      btn.setAttribute("data-activate-bound", "1");
      var defaultLabel = btn.getAttribute("data-default-label") || btn.textContent.trim() || "Start with AI";
      var feedbackId = btn.getAttribute("data-copy-feedback");
      var feedback = feedbackId ? doc.getElementById(feedbackId) : null;
      var targetId = btn.getAttribute("data-copy-target");
      var target = targetId ? doc.getElementById(targetId) : null;
      btn.addEventListener("click", function (ev) {
        if (btn.tagName === "A") ev.preventDefault();
        copyCommand(ACTIVATE_COMMAND, target).then(function (copied) {
          if (copied) {
            var prevWidth = btn.offsetWidth;
            btn.style.minWidth = prevWidth + "px";
            btn.classList.add("is-copied");
            btn.textContent = COPIED_LABEL;
            if (feedback) {
              feedback.textContent = "Copied: " + ACTIVATE_COMMAND;
              feedback.className = (feedback.className || "").replace(/\b(ok|err)\b/g, "").trim() + " ok";
            }
            setTimeout(function () {
              btn.classList.remove("is-copied");
              btn.textContent = defaultLabel;
            }, 1800);
          } else {
            if (target) { target.focus && target.focus(); target.select && target.select(); }
            if (feedback) {
              feedback.textContent =
                "Clipboard access failed. Select the command above and copy it manually (Ctrl+C / Cmd+C).";
              feedback.className = (feedback.className || "").replace(/\b(ok|err)\b/g, "").trim() + " err";
            }
          }
        });
      });
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { wire(document); });
    } else {
      wire(document);
    }
  }

  return {
    ACTIVATE_COMMAND: ACTIVATE_COMMAND,
    HELPER_TEXT: HELPER_TEXT,
    STATUS_NOTE: STATUS_NOTE,
    LEARN_MORE_URL: LEARN_MORE_URL,
    COPIED_LABEL: COPIED_LABEL,
    copyCommand: copyCommand,
    wire: wire
  };
});
