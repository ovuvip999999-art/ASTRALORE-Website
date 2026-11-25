/* V8 — ASTRA local interface preview. No messages leave this browser. */
(() => {
  const launcher = document.getElementById("astraLauncher");
  const panel = document.getElementById("astraWidget");
  const close = document.getElementById("astraClose");
  const form = document.getElementById("astraForm");
  const input = document.getElementById("astraInput");
  const chat = document.getElementById("astraChat");
  const suggestions = document.getElementById("astraSuggestions");
  if (!launcher || !panel || !form || !input || !chat) return;

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
    label.textContent = who === "user" ? "YOU" : "ASTRA // PREVIEW";
    bubble.appendChild(label);
    bubble.appendChild(document.createTextNode(text));
    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;
  }

  function previewReply(question) {
    const q = question.toLowerCase();
    if (q.includes("venus")) return "Venus is extremely hot because its thick atmosphere traps heat through an intense greenhouse effect. Its surface is hot enough to melt lead. This is a sample response from ASTRA's preview knowledge.";
    if (q.includes("black hole")) return "A black hole is a region where gravity is so strong that nothing—not even light—can escape from within its event horizon. It can form when a massive star's core collapses. This is a sample response from ASTRA's preview knowledge.";
    if (q.includes("myth") || q.includes("hindu")) return "Mythology is filled with layered stories, symbols and philosophical ideas. ASTRA is planned to explore these respectfully, distinguish traditional accounts from historical evidence, and point you toward ASTRALORE videos.";
    if (q.includes("mystery") || q.includes("cosmic")) return "One fascinating cosmic mystery is dark matter: observations suggest it contributes to the gravity holding galaxies together, yet it does not emit or reflect light in the usual way. Its nature remains unknown.";
    return "Signal received. The full ASTRA intelligence system is not connected yet. This V8 build is an interface preview; real AI answers, broader knowledge and ASTRALORE video recommendations will arrive in a later release.";
  }

  function send(text) {
    const message = text.trim();
    if (!message) return;
    addMessage(message, "user");
    if (suggestions) suggestions.hidden = true;
    input.value = "";
    window.setTimeout(() => addMessage(previewReply(message), "bot"), 280);
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
})();
