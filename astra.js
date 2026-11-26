
/* V14 — ASTRA assistant. Robust Markdown code blocks, safe rendering, copy buttons and session context. */
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

  const API_URL = typeof window.ASTRA_API_URL === "string"
    ? window.ASTRA_API_URL.trim()
    : "";

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

  launcher.addEventListener("click", () =>
    panel.classList.contains("is-open") ? closePanel() : openPanel()
  );

  if (close) close.addEventListener("click", closePanel);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) {
      closePanel();
    }
  });

  function appendInline(parent, text) {
    const pattern =
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;

    const source = String(text);
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(source)) !== null) {
      parent.appendChild(
        document.createTextNode(source.slice(lastIndex, match.index))
      );

      if (match[1] && match[2]) {
        try {
          const url = new URL(match[2]);

          if (url.protocol === "https:" || url.protocol === "http:") {
            const link = document.createElement("a");
            link.href = url.href;
            link.textContent = match[1];
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            parent.appendChild(link);
          } else {
            parent.appendChild(document.createTextNode(match[0]));
          }
        } catch {
          parent.appendChild(document.createTextNode(match[0]));
        }
      } else if (match[3]) {
        const strong = document.createElement("strong");
        strong.textContent = match[3];
        parent.appendChild(strong);
      } else if (match[4]) {
        const italic = document.createElement("em");
        italic.textContent = match[4];
        parent.appendChild(italic);
      } else if (match[5]) {
        const code = document.createElement("code");
        code.textContent = match[5];
        parent.appendChild(code);
      }

      lastIndex = pattern.lastIndex;
    }

    parent.appendChild(
      document.createTextNode(source.slice(lastIndex))
    );
  }

  // Remove only common Markdown-escaping artifacts from generated code.
  // Legitimate JavaScript strings, regexes and file paths are preserved.
  function cleanEscapedCode(code) {
    return String(code)
      .replace(/\\(?=<\/?[A-Za-z!])/g, "")
      .replace(/^(\s*)\\#/gm, "$1#")
      .replace(/&#x20;/gi, " ");
  }

  function addCodeBlock(container, code, language) {
    const wrapper = document.createElement("div");
    wrapper.className = "astra-code-block";

    const toolbar = document.createElement("div");
    toolbar.className = "astra-code-toolbar";

    const languageLabel = document.createElement("span");
    languageLabel.className = "astra-code-language";
    languageLabel.textContent = language || "CODE";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "astra-copy-code";
    copyButton.textContent = "Copy code";

    const pre = document.createElement("pre");
    const codeElement = document.createElement("code");

    codeElement.className = language
      ? "language-" + language.toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : "";

    const cleanCode = cleanEscapedCode(code);

    // textContent prevents generated HTML from executing.
    codeElement.textContent = cleanCode;

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cleanCode);
        copyButton.textContent = "Copied!";

        setTimeout(() => {
          copyButton.textContent = "Copy code";
        }, 1600);
      } catch {
        copyButton.textContent = "Copy unavailable";
      }
    });

    pre.appendChild(codeElement);
    toolbar.appendChild(languageLabel);
    toolbar.appendChild(copyButton);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(pre);
    container.appendChild(wrapper);
  }

  // Recognize normal fences and individually escaped backticks.
  function getCodeFence(line) {
    const trimmed = line.trim();

    const normal = trimmed.match(
      /^(`{3,}|~~~)\s*([a-zA-Z0-9_+#.-]*)\s*$/
    );

    if (normal) {
      return {
        language: normal[2] || "",
        marker: normal[1]
      };
    }

    const escaped = trimmed.match(
      /^(?:\\`){3,}\s*([a-zA-Z0-9_+#.-]*)\s*$/
    );

    if (escaped) {
      return {
        language: escaped[1] || "",
        marker: "escaped"
      };
    }

    return null;
  }

  function renderAnswer(container, text) {
    const lines = String(text)
      .replace(/\r\n/g, "\n")
      .split("\n");

    let list = null;
    let table = null;
    let codeLines = null;
    let codeLanguage = "";
    let activeFence = null;

    function resetBlocks() {
      list = null;
      table = null;
    }

    lines.forEach(line => {
      const trimmed = line.trim();
      const fence = getCodeFence(line);

      if (fence) {
        resetBlocks();

        if (codeLines === null) {
          codeLines = [];
          codeLanguage = fence.language;
          activeFence = fence.marker;
        } else {
          addCodeBlock(container, codeLines.join("\n"), codeLanguage);
          codeLines = null;
          codeLanguage = "";
          activeFence = null;
        }

        return;
      }

      if (codeLines !== null) {
        codeLines.push(line);
        return;
      }

      if (!trimmed) {
        resetBlocks();
        return;
      }

      const heading = trimmed.match(/^#{1,4}\s+(.+)$/);

      if (heading) {
        resetBlocks();

        const h = document.createElement("h4");
        appendInline(h, heading[1]);
        container.appendChild(h);
        return;
      }

      if (trimmed.includes("|")) {
        const cells = trimmed.split("|")
          .slice(1, -1)
          .map(cell => cell.trim());

        if (cells.length) {
          if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) {
            return;
          }

          if (!table) {
            table = document.createElement("table");
            container.appendChild(table);
          }

          const row = document.createElement("tr");

          cells.forEach(cell => {
            const element = document.createElement("td");
            appendInline(element, cell);
            row.appendChild(element);
          });

          table.appendChild(row);
          list = null;
          return;
        }
      }

      table = null;

      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);

      if (bullet || numbered) {
        const type = bullet ? "ul" : "ol";

        if (!list || list.tagName.toLowerCase() !== type) {
          list = document.createElement(type);
          container.appendChild(list);
        }

        const item = document.createElement("li");
        appendInline(item, (bullet || numbered)[1]);
        list.appendChild(item);
        return;
      }

      list = null;

      const paragraph = document.createElement("p");
      appendInline(paragraph, trimmed);
      container.appendChild(paragraph);
    });

    // Safely display unfinished code blocks too.
    if (codeLines !== null) {
      addCodeBlock(container, codeLines.join("\n"), codeLanguage);
    }
  }

  function addMessage(text, who) {
    const bubble = document.createElement("div");
    bubble.className = "astra-message astra-message-" + who;

    const label = document.createElement("span");
    label.className = "astra-message-label";
    label.textContent = who === "user" ? "YOU" : "ASTRA";
    bubble.appendChild(label);

    const content = document.createElement("div");
    content.className = "astra-message-content";

    if (who === "bot") {
      renderAnswer(content, text);
    } else {
      content.textContent = text;
    }

    bubble.appendChild(content);
    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;

    return bubble;
  }

  async function askAstra(question) {
    if (!API_URL) {
      throw new Error("ASTRA's live connection is not configured yet.");
    }

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
      throw new Error(
        data.error || "ASTRA couldn't connect right now. Please try again."
      );
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

    const submitButton = form.querySelector("button[type='submit']");

    if (submitButton) {
      submitButton.disabled = true;
    }

    addMessage(message, "user");

    if (suggestions) {
      suggestions.hidden = true;
    }

    input.value = "";

    const typing = addMessage("Receiving signal…", "bot");
    typing.classList.add("astra-message-loading");

    try {
      const reply = await askAstra(message);

      typing.remove();
      addMessage(reply, "bot");

      history.push(
        { role: "user", content: message },
        { role: "assistant", content: reply }
      );

      if (history.length > 16) {
        history.splice(0, history.length - 16);
      }
    } catch (error) {
      typing.remove();

      addMessage(
        error.message || "Connection interrupted. Please try again.",
        "bot"
      );
    } finally {
      busy = false;
      input.disabled = false;

      if (submitButton) {
        submitButton.disabled = false;
      }

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

      if (button) {
        send(button.dataset.prompt);
      }
    });
  }

  if (API_URL) {
    if (status) {
      status.innerHTML = "<i></i> LIVE CONNECTION";
    }

    if (disclaimer) {
      disclaimer.textContent = "ASTRALORE AI · SESSION CONTEXT ACTIVE";
    }
  } else {
    if (status) {
      status.innerHTML = "<i></i> OFFLINE";
    }

    if (disclaimer) {
      disclaimer.textContent = "ASTRA LIVE CONNECTION NOT CONFIGURED";
    }
  }
})();
