/* V9 — ASTRA assistant. Uses a secure backend when configured; preview fallback otherwise. */
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

  function addMessage(text, who) {
    const bubble = document.createElement("div");
    bubble.className = "astra-message astra-message-" + who;
    const label = document.createElement("span");
    label.className = "astra-message-label";
    label.textContent = who === "user" ? "YOU" : "ASTRA";
    bubble.appendChild(label);
    bubble.appendChild(document.createTextNode(text));
    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;
    return bubble;
  }

  function previewReply(question) {
    const q = question.toLowerCase();
    if (q.includes("venus")) return "Venus is extremely hot because its thick atmosphere traps heat through an intense greenhouse effect. Its surface is hot enough to melt lead. This is a sample response from ASTRA's preview knowledge.";
    if (q.includes("black hole")) return "A black hole is a region where gravity is so strong that nothing—not even light—can escape from within its event horizon. It can form when a massive star's core collapses. This is a sample response from ASTRA's preview knowledge.";
    if (q.includes("myth") || q.includes("hindu")) return "Mythology is filled with layered stories, symbols and philosophical ideas. ASTRA is planned to explore these respectfully, distinguish traditional accounts from historical evidence, and point you toward ASTRALORE videos.";
    if (q.includes("mystery") || q.includes("cosmic")) return "One fascinating cosmic mystery is dark matter: observations suggest it contributes to the gravity holding galaxies together, yet it does not emit or reflect light in the usual way. Its nature remains unknown.";
    return "Signal received. ASTRA's live AI backend is not configured yet. This is still the V9 connection-ready preview.";
  }

  async function askAstra(question) {
    if (!API_URL) {
      await new Promise(resolve => window.setTimeout(resolve, 280));
      return previewReply(question);
    }
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: question,
        history: history.slice(-8)
      })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "ASTRA couldn't connect right now. Please try again.");
    }
    const data = await response.json();
    if (!data.reply || typeof data.reply !== "string") throw new Error("ASTRA returned an empty signal. Please try again.");
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
    if (disclaimer) disclaimer.textContent = "ASTRALORE AI · RESPONSES GENERATED LIVE";
  } else {
    if (status) status.innerHTML = "<i></i> PREVIEW MODE";
    if (disclaimer) disclaimer.textContent = "CONNECTION READY · BACKEND URL NOT SET";
  }
})();
