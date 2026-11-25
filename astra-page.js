
/* ASTRA V15 — Dedicated AI page */
(() => {
  const form = document.getElementById("astraForm");
  const input = document.getElementById("astraInput");
  const chat = document.getElementById("astraChat");
  const welcome = document.getElementById("astraWelcome");
  const suggestions = document.getElementById("astraSuggestions");
  const status = document.getElementById("astraStatus");
  const newChat = document.getElementById("newChat");

  const API_URL = typeof window.ASTRA_API_URL === "string"
    ? window.ASTRA_API_URL.trim()
    : "";

  if (!form || !input || !chat) return;

  let history = [];
  let busy = false;

  function appendInline(parent, text) {
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
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

  function renderAnswer(container, text) {
    const lines = String(text).split(/\r?\n/);
    let list = null;
    let table = null;

    lines.forEach(line => {
      const trimmed = line.trim();

      if (!trimmed) {
        list = null;
        table = null;
        return;
      }

      const heading = trimmed.match(/^#{1,4}\s+(.+)$/);

      if (heading) {
        list = null;
        table = null;

        const h = document.createElement("h4");
        appendInline(h, heading[1]);
        container.appendChild(h);
        return;
      }

      if (trimmed.includes("|")) {
        const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "")
          .split("|").map(cell => cell.trim());

        if (cells.length && cells.every(cell => /^:?-{3,}:?$/.test(cell))) {
          return;
        }

        if (cells.length > 1) {
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

      if (/^([-*_])\1{2,}$/.test(trimmed)) {
        const divider = document.createElement("hr");
        container.appendChild(divider);
        return;
      }

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
      throw new Error("ASTRA's live connection is not configured.");
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
        data.error || "ASTRA couldn't connect. Please try again."
      );
    }

    if (!data.reply || typeof data.reply !== "string") {
      throw new Error("ASTRA returned an empty response. Please try again.");
    }

    return data.reply;
  }

  async function send(text) {
    const message = text.trim();

    if (!message || busy) return;

    busy = true;
    input.disabled = true;

    const sendButton = form.querySelector("button[type='submit']");
    if (sendButton) sendButton.disabled = true;

    if (welcome) welcome.hidden = true;

    addMessage(message, "user");
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

      if (sendButton) sendButton.disabled = false;

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

  if (newChat) {
    newChat.addEventListener("click", () => {
      if (busy) return;

      history = [];
      chat.querySelectorAll(".astra-message").forEach(message => message.remove());

      if (welcome) welcome.hidden = false;

      input.value = "";
      input.focus();
    });
  }

  if (API_URL) {
    if (status) status.textContent = "LIVE CONNECTION";
  } else {
    if (status) status.textContent = "OFFLINE";
  }
})();
