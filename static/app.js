/* Themed Dashboard + Genie — frontend logic. */
(function () {
  "use strict";

  const state = {
    cfg: null,
    conversationId: null,
    polling: false,
  };

  const $ = (id) => document.getElementById(id);

  // ---- Theme handling ---------------------------------------------------
  const THEME_KEY = "themed-dashboard-theme";

  function applyTheme(key) {
    const theme = window.THEMES[key];
    if (!theme) return;
    document.documentElement.setAttribute("data-theme", key);
    $("brand-badge").textContent = theme.badge;
    $("brand-tagline").textContent = theme.tagline;
    $("theme-select").value = key;
    renderSuggestions(theme.sampleQuestions || []);
    try {
      localStorage.setItem(THEME_KEY, key);
    } catch (e) {
      /* private mode — ignore */
    }
  }

  function initTheme(defaultTheme) {
    // Precedence: ?theme= URL override > saved choice > server default.
    let urlTheme = null;
    try {
      urlTheme = new URLSearchParams(window.location.search).get("theme");
    } catch (e) {
      /* ignore */
    }
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (e) {
      /* ignore */
    }
    const chosen =
      (urlTheme && window.THEMES[urlTheme] && urlTheme) ||
      (saved && window.THEMES[saved] && saved) ||
      defaultTheme ||
      "stlukes";
    applyTheme(chosen);
    $("theme-select").addEventListener("change", (e) => applyTheme(e.target.value));
  }

  // ---- Config + dashboard ----------------------------------------------
  async function loadConfig() {
    const res = await fetch("/api/config");
    state.cfg = await res.json();

    if (state.cfg.appTitle) {
      $("app-title").textContent = state.cfg.appTitle;
      document.title = state.cfg.appTitle;
    }

    const frame = $("dashboard-frame");
    const placeholder = $("dashboard-placeholder");
    if (state.cfg.dashboardEmbedUrl) {
      frame.src = state.cfg.dashboardEmbedUrl;
      $("dashboard-open-link").href =
        `https://${state.cfg.host}/dashboardsv3/${state.cfg.dashboardId}/published`;
      // If the iframe is blocked (X-Frame-Options / not an approved domain),
      // it stays blank; surface the fallback card after a grace period.
      setTimeout(() => {
        try {
          // Cross-origin: we can't read the doc, but a blocked frame has no
          // history entry. This is a best-effort hint only.
          if (!frame.contentWindow || frame.contentWindow.length === undefined) {
            placeholder.classList.remove("hidden");
          }
        } catch (e) {
          placeholder.classList.remove("hidden");
        }
      }, 4000);
    } else {
      placeholder.classList.remove("hidden");
      $("placeholder-msg").textContent =
        "No dashboard configured. Set DASHBOARD_ID in config.py or app.yaml.";
    }

    return state.cfg;
  }

  // ---- Genie panel open/close ------------------------------------------
  function openGenie() {
    $("genie-panel").classList.add("open");
    $("genie-panel").setAttribute("aria-hidden", "false");
    $("genie-scrim").hidden = false;
    $("genie-input").focus();
  }
  function closeGenie() {
    $("genie-panel").classList.remove("open");
    $("genie-panel").setAttribute("aria-hidden", "true");
    $("genie-scrim").hidden = true;
  }

  // ---- Genie chat -------------------------------------------------------
  function renderSuggestions(questions) {
    const wrap = $("genie-suggestions");
    if (!wrap) return;
    wrap.innerHTML = "";
    questions.forEach((q) => {
      const chip = document.createElement("button");
      chip.className = "suggestion-chip";
      chip.type = "button";
      chip.textContent = q;
      chip.addEventListener("click", () => {
        $("genie-input").value = q;
        submitQuestion();
      });
      wrap.appendChild(chip);
    });
  }

  function addMessage(role, contentNode) {
    const welcome = document.querySelector(".genie-welcome");
    if (welcome) welcome.remove();
    const wrap = document.createElement("div");
    wrap.className = `msg msg-${role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (typeof contentNode === "string") bubble.textContent = contentNode;
    else bubble.appendChild(contentNode);
    wrap.appendChild(bubble);
    $("genie-messages").appendChild(wrap);
    $("genie-messages").scrollTop = $("genie-messages").scrollHeight;
    return bubble;
  }

  function makeTypingBubble() {
    const el = document.createElement("div");
    el.className = "typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    return el;
  }

  function renderAnswer(bubble, result) {
    bubble.innerHTML = "";

    if (result.text) {
      const p = document.createElement("div");
      p.className = "answer-text";
      p.textContent = result.text;
      bubble.appendChild(p);
    }

    if (result.columns && result.data) {
      bubble.appendChild(buildTable(result.columns, result.data, result.rowCount));
    }

    if (result.sql) {
      const details = document.createElement("details");
      details.className = "sql-details";
      const summary = document.createElement("summary");
      summary.textContent = "View SQL";
      const pre = document.createElement("pre");
      pre.className = "sql-block";
      pre.textContent = result.sql;
      details.appendChild(summary);
      details.appendChild(pre);
      bubble.appendChild(details);
    }

    if (!result.text && !result.columns && !result.sql) {
      bubble.textContent = "Genie returned no content for that question.";
    }
  }

  function buildTable(columns, data, rowCount) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    columns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    data.slice(0, 50).forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell === null ? "—" : cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (rowCount > 50) {
      const note = document.createElement("div");
      note.className = "table-note";
      note.textContent = `Showing 50 of ${rowCount} rows.`;
      wrap.appendChild(note);
    }
    return wrap;
  }

  async function submitQuestion() {
    const input = $("genie-input");
    const content = input.value.trim();
    if (!content || state.polling) return;

    input.value = "";
    input.style.height = "auto";
    addMessage("user", content);

    const answerBubble = addMessage("genie", makeTypingBubble());
    state.polling = true;
    setSendEnabled(false);

    try {
      const askRes = await fetch("/api/genie/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          conversationId: state.conversationId,
        }),
      });
      const ask = await askRes.json();
      if (ask.error) throw new Error(ask.error);
      state.conversationId = ask.conversationId;

      const result = await pollResult(ask.conversationId, ask.messageId);
      if (result.error) {
        answerBubble.textContent = `⚠️ ${result.error}`;
        answerBubble.classList.add("error");
      } else {
        renderAnswer(answerBubble, result);
      }
    } catch (err) {
      answerBubble.textContent = `⚠️ ${err.message || err}`;
      answerBubble.classList.add("error");
    } finally {
      state.polling = false;
      setSendEnabled(true);
      $("genie-messages").scrollTop = $("genie-messages").scrollHeight;
    }
  }

  async function pollResult(conversationId, messageId) {
    // Poll until terminal. Each request is quick, so we never trip the
    // Databricks Apps ~60s proxy timeout even for long Genie runs.
    const maxAttempts = 120; // ~3 min at 1.5s cadence
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(
        `/api/genie/result?conversationId=${encodeURIComponent(
          conversationId
        )}&messageId=${encodeURIComponent(messageId)}`
      );
      const data = await res.json();
      if (data.status === "COMPLETED" || data.error) return data;
      await sleep(1500);
    }
    return { error: "Timed out waiting for Genie." };
  }

  function setSendEnabled(enabled) {
    $("genie-send").disabled = !enabled;
    $("genie-input").disabled = !enabled;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function newConversation() {
    state.conversationId = null;
    $("genie-messages").innerHTML = "";
    const theme = window.THEMES[$("theme-select").value];
    const welcome = document.createElement("div");
    welcome.className = "genie-welcome";
    welcome.innerHTML =
      '<p class="genie-welcome-title">Ask a question about your data.</p>' +
      '<div id="genie-suggestions" class="genie-suggestions"></div>';
    $("genie-messages").appendChild(welcome);
    renderSuggestions((theme && theme.sampleQuestions) || []);
  }

  // ---- Wire up ----------------------------------------------------------
  function init() {
    loadConfig()
      .then((cfg) => initTheme(cfg.defaultTheme))
      .catch(() => initTheme("stlukes"));

    $("genie-fab").addEventListener("click", openGenie);
    $("genie-close").addEventListener("click", closeGenie);
    $("genie-scrim").addEventListener("click", closeGenie);
    $("genie-new").addEventListener("click", newConversation);

    $("genie-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submitQuestion();
    });

    const input = $("genie-input");
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitQuestion();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeGenie();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
