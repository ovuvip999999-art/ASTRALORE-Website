/* V11 — ASTRA assistant. Safe formatted responses, session context and live backend support. */
(() => {
  const launcher = document.getElementById("astraLauncher");
  const panel = document.getElementById("astraWidget");
  const close = document.getElementById("astraClose");
  const form = document.getElementById("astraForm");
  const input = document.getElementById("astraInput");
  const chat = document.getElementById("astraChat");
  const suggestions = document.getElementById("astraSuggestions");
  const status = document.querySelector(".astra-status");
  const disclaimer = document.querySelector(".astra-disclaimer");
  const API_URL = typeof window.ASTRA_API_URL === "string" ? window.ASTRA_API_URL.trim() : "";
  if (!launcher || !panel || !form || !input || !chat) return;

  const history = [];
  let busy = false;

  function openPanel() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
  }
  function closePanel() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }
  launcher.addEventListener("click", () => panel.classList.contains("is-open") ? closePanel() : openPanel());
  close.addEventListener("click", closePanel);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) closePanel();
  });

  function appendInline(parent, text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    parts.forEach(part => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  function renderAnswer(container, text) {
    const lines = String(text).split(/\r?\n/);
    let list = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        list = null;
        return;
      }

      const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
      if (heading) {
        list = null;
        const h = document.createElement("h4");
        appendInline(h, heading[1]);
        container.appendChild(h);
        return;
      }

      const bullet = trimmed.match(/^(?:[-*])\s+(.+)$/);
      if (bullet) {
        if (!list) {
          list = document.createElement("ul");
          container.appendChild(list);
        }
        const item = document.createElement("li");
        appendInline(item, bullet[1]);
        list.appendChild(item);
        return;
      }

      list = null;
      const paragraph = document.createElement("p");
      appendInline(paragraph, trimmed);
      container.appendChild(paragraph);
    });
  }

  function addMessage(text, who) {
    const bubble = document.createElement("div");
    bubble.className = "astra-message astra-message-" + who;
    const label = document.createElement("span");
    label.className = "astra-message-label";
    label.textContent = who === "user" ? "YOU" : "ASTRA";
    bubble.appendChild(label);

    if (who === "bot") {
      const content = document.createElement("div");
      content.className = "astra-message-content";
      renderAnswer(content, text);
      bubble.appendChild(content);
    } else {
      const content = document.createElement("div");
      content.className = "astra-message-content";
      content.textContent = text;
      bubble.appendChild(content);
    }

    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;
    return bubble;
  }

  async function askAstra(question) {
    if (!API_URL) throw new Error("ASTRA's live connection is not configured yet.");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: question,
        history: history.slice(-8)
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "ASTRA couldn't connect right now. Please try again.");
    }
    if (!data.reply || typeof data.reply !== "string") {
      throw new Error("ASTRA returned an empty signal. Please try again.");
    }
    return data.reply;
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    busy = true;
    input.disabled = true;
    form.querySelector("button[type='submit']").disabled = true;
    addMessage(message, "user");
    if (suggestions) suggestions.hidden = true;
    input.value = "";
    const typing = addMessage("Receiving signal…", "bot");
    typing.classList.add("astra-message-loading");

    try {
      const reply = await askAstra(message);
      typing.remove();
      addMessage(reply, "bot");
      history.push({ role: "user", content: message }, { role: "assistant", content: reply });
      if (history.length > 16) history.splice(0, history.length - 16);
    } catch (error) {
      typing.remove();
      addMessage(error.message || "Connection interrupted. Please try again.", "bot");
    } finally {
      busy = false;
      input.disabled = false;
      form.querySelector("button[type='submit']").disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    send(input.value);
  });
  if (suggestions) {
    suggestions.addEventListener("click", event => {
      const button = event.target.closest("button[data-prompt]");
      if (button) send(button.dataset.prompt);
    });
  }

  if (API_URL) {
    if (status) status.innerHTML = "<i></i> LIVE CONNECTION";
    if (disclaimer) disclaimer.textContent = "ASTRALORE AI · SESSION CONTEXT ACTIVE";
  } else {
    if (status) status.innerHTML = "<i></i> OFFLINE";
    if (disclaimer) disclaimer.textContent = "ASTRA LIVE CONNECTION NOT CONFIGURED";
  }
})();
