
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

  if (window.ASTRAMemory) window.ASTRAMemory.ensureConversation();
  let history = window.ASTRAMemory ? window.ASTRAMemory.getCurrentMessages() : [];
  let cloudConversation = null;
  let cloudReady = false;
  let cloudInitPromise = null;
  let busy = false;
  let signedIn = document.body.dataset.authenticated === "true";

  async function initializeCloudArchive() {
    if (!window.ASTRACloud || !window.ASTRASupabase) return;
    if (cloudInitPromise) return cloudInitPromise;
    cloudInitPromise = (async () => {
      try {
        const user = await window.ASTRACloud.requireUser();
        signedIn = true;
        const conversations = await window.ASTRACloud.listConversations();
        cloudConversation = conversations[0] || await window.ASTRACloud.createConversation("New conversation");
        history = await window.ASTRACloud.loadMessages(cloudConversation.id);
        chat.querySelectorAll(".astra-message").forEach(message => message.remove());
        history.slice(-100).forEach((item, offset) => {
          const index = history.length - Math.min(history.length, 100) + offset;
          addMessage(item.content, item.role === "user" ? "user" : "bot", index);
        });
        if (welcome) welcome.hidden = history.length > 0;
        cloudReady = true;
        await refreshCloudArchive();
        if (status) status.textContent = "CLOUD SYNC · " + (user.email || "SIGNED IN");
      } catch (error) {
        cloudReady = false;
        if (status) status.textContent = "LOCAL MODE · " + (error.message || "CLOUD UNAVAILABLE");
      } finally {
        cloudInitPromise = null;
      }
    })();
    return cloudInitPromise;
  }

  function createArchiveRow(item, isCloud) {
    const row = document.createElement("div");
    row.className = "archive-row";
    row.dataset.rowId = item.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "archive-conversation" + ((isCloud ? item.id === cloudConversation?.id : item.id === window.ASTRAMemory?.getCurrentConversationId()) ? " active" : "");
    if (isCloud) open.dataset.cloudConversationId = item.id;
    else open.dataset.conversationId = item.id;
    const title = document.createElement("span");
    title.className = "archive-conversation-title";
    title.textContent = item.title || "Conversation";
    const meta = document.createElement("small");
    meta.textContent = new Date(isCloud ? item.updated_at : item.updatedAt).toLocaleDateString();
    open.append(title, meta);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "archive-more";
    more.textContent = "⋯";
    more.setAttribute("aria-label", "Conversation options");
    more.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "archive-menu";
    menu.hidden = true;
    [["edit","Rename"],["share","Share"],["delete","Delete"]].forEach(([action,label]) => {
      const option = document.createElement("button");
      option.type = "button";
      option.dataset.chatAction = action;
      option.dataset.chatId = item.id;
      option.dataset.cloud = isCloud ? "true" : "false";
      option.textContent = label;
      if (action === "delete") option.className = "archive-menu-danger";
      menu.appendChild(option);
    });
    more.addEventListener("click", event => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      archiveList.querySelectorAll(".archive-menu").forEach(node => { node.hidden = true; });
      archiveList.querySelectorAll(".archive-more").forEach(node => node.setAttribute("aria-expanded","false"));
      menu.hidden = !willOpen;
      more.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    row.append(open, more, menu);
    return row;
  }

  async function refreshCloudArchive() {
    if (!cloudReady || !window.ASTRACloud) return;
    const query = archiveSearch ? archiveSearch.value.trim() : "";
    const conversations = await window.ASTRACloud.listConversations();
    archiveList.replaceChildren();
    const matching = query
      ? await window.ASTRACloud.searchMessages(query)
      : [];
    const ids = query ? [...new Set(matching.map(item => item.conversation_id))] : conversations.map(item => item.id);
    const shown = conversations.filter(item => ids.includes(item.id));
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "archive-empty";
      empty.textContent = query ? "No matching conversations." : "Your cloud conversations will appear here.";
      archiveList.appendChild(empty);
      return;
    }
    shown.forEach(item => archiveList.appendChild(createArchiveRow(item, true)));
  }

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
  const lines = String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let list = null;
  let table = null;
  let codeLines = null;
  let codeLanguage = "";

  function resetBlocks() {
    list = null;
    table = null;
  }

  function getFence(line) {
    const normalized = line.trim().replace(/\\+(?=`)/g, "");
    const match = normalized.match(/^(`{3,}|~~~)\s*([a-zA-Z0-9_+#.-]*)\s*$/);

    return match
      ? { marker: match[1], language: match[2] || "" }
      : null;
  }

  function finishCodeBlock() {
    const wrapper = document.createElement("div");
    wrapper.className = "astra-code-block";

    const toolbar = document.createElement("div");
    toolbar.className = "astra-code-toolbar";

    const label = document.createElement("span");
    label.className = "astra-code-language";
    label.textContent = codeLanguage || "CODE";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "astra-copy-code";
    copyButton.textContent = "Copy code";

    const pre = document.createElement("pre");
    const code = document.createElement("code");

    code.className = codeLanguage
      ? "language-" + codeLanguage.toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : "";

    const cleanCode = codeLines.join("\n")
  .replace(/\\+(?=<\/?[A-Za-z!])/g, "")
  .replace(/\\+(?=<!DOCTYPE)/gi, "")
  .replace(/\\+(?=```)/g, "")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#x20;/gi, " ")
  .replace(/&#39;/gi, "'")
  .replace(/&quot;/gi, '"');

    code.textContent = cleanCode;

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cleanCode);
        copyButton.textContent = "Copied!";
      } catch {
        copyButton.textContent = "Copy unavailable";
      }
    });

    toolbar.appendChild(label);
    toolbar.appendChild(copyButton);
    pre.appendChild(code);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(pre);
    container.appendChild(wrapper);

    codeLines = null;
    codeLanguage = "";
  }

  lines.forEach(line => {
    const trimmed = line.trim();
    const fence = getFence(line);

    // Code fence detection
    if (fence) {
      resetBlocks();

      if (codeLines === null) {
        codeLines = [];
        codeLanguage = fence.language;
      } else {
        finishCodeBlock();
      }

      return;
    }

    // Preserve every line inside code blocks
    if (codeLines !== null) {
      codeLines.push(line);
      return;
    }

    if (!trimmed) {
      resetBlocks();
      return;
    }

    // Clean escaped Markdown outside code blocks
    const cleanLine = trimmed
      .replace(/\\+(?=`|<|>)/g, "")
      .replace(/^\\#/g, "#");

    const heading = cleanLine.match(/^#{1,4}\s+(.+)$/);

    if (heading) {
      resetBlocks();

      const h = document.createElement("h4");
      appendInline(h, heading[1]);
      container.appendChild(h);
      return;
    }

    if (cleanLine.includes("|")) {
      const cells = cleanLine
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(cell => cell.trim());

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

    const bullet = cleanLine.match(/^[-*]\s+(.+)$/);
    const numbered = cleanLine.match(/^\d+[.)]\s+(.+)$/);

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

    if (/^([-*_])\1{2,}$/.test(cleanLine)) {
      container.appendChild(document.createElement("hr"));
      return;
    }

    const paragraph = document.createElement("p");
    appendInline(paragraph, cleanLine);
    container.appendChild(paragraph);
  });

  // Handle code blocks without a closing fence
  if (codeLines !== null) {
    finishCodeBlock();
  }
}


  function addMessage(text, who, messageIndex = null) {
    const bubble = document.createElement("div");
    bubble.className = "astra-message astra-message-" + who;
    if (who === "user" && Number.isInteger(messageIndex)) {
      bubble.dataset.messageIndex = String(messageIndex);
    }

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
    if (who === "user" && Number.isInteger(messageIndex)) {
      const actions = document.createElement("div");
      actions.className = "astra-message-actions";
      [["edit","Edit"],["delete","Delete"],["share","Share"]].forEach(([action,labelText]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "astra-message-action astra-message-action-" + action;
        button.dataset.messageAction = action;
        button.dataset.messageIndex = String(messageIndex);
        button.textContent = labelText;
        actions.appendChild(button);
      });
      bubble.appendChild(actions);
    }
    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;

    return bubble;
  }

  // Restore the most recent conversation stored on this device.
  if (history.length) {
    history.slice(-100).forEach((item, offset) => {
      const index = history.length - Math.min(history.length, 100) + offset;
      addMessage(item.content, item.role === "user" ? "user" : "bot", index);
    });
    if (welcome) welcome.hidden = true;
  }

  async function askAstra(question) {
    if (!signedIn) throw new Error("Sign in to use ASTRA.");
    if (!API_URL) {
      throw new Error("ASTRA's live connection is not configured.");
    }

    const sessionResult = window.ASTRASupabase ? await window.ASTRASupabase.auth.getSession() : { data: { session: null } };
    const accessToken = sessionResult.data?.session?.access_token;
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { "Authorization": "Bearer " + accessToken } : {})
      },
      body: JSON.stringify({
        message: question,
        history: history.slice(-9, -1),
        memory: window.ASTRAMemory ? window.ASTRAMemory.getMemories().map(item => item.text) : []
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

    return data;
  }

  async function send(text) {
    const message = text.trim();

    if (!signedIn) {
      const accountDialog = document.getElementById("astraAccountDialog");
      if (accountDialog && !accountDialog.open && typeof accountDialog.showModal === "function") accountDialog.showModal();
      if (status) status.textContent = "SIGN IN REQUIRED";
      return;
    }
    if (!message || busy) return;

    busy = true;
    input.disabled = true;

    const sendButton = form.querySelector("button[type='submit']");
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.textContent = "…";
      sendButton.setAttribute("aria-label", "ASTRA is responding");
    }
    input.placeholder = "ASTRA is thinking…";
    if (status) status.textContent = "ASTRA IS THINKING";

    if (welcome) welcome.hidden = true;

    const userSequence = history.length;
    addMessage(message, "user", userSequence);
    input.value = "";
    history.push({ role: "user", content: message });
    if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.saveCurrentMessages(history);
    if (window.ASTRACloud && cloudReady && cloudConversation) {
      try {
        await window.ASTRACloud.appendMessages(cloudConversation, [
          { role: "user", content: message, sequence_no: userSequence }
        ]);
      } catch (saveError) {
        if (status) status.textContent = "CLOUD SAVE ISSUE · " + (saveError.message || "RETRY LATER");
      }
    }

    const typing = addMessage("Receiving signal…", "bot");
    typing.classList.add("astra-message-loading");

    try {
      const data = await askAstra(message);
      const reply = data.reply;
      if (status) status.textContent = "ONLINE";

      typing.remove();
      addMessage(reply, "bot");

      const assistantSequence = history.length;
      history.push({ role: "assistant", content: reply });

      if (!cloudReady && history.length > 500) {
        history.splice(0, history.length - 500);
      }
      if (window.ASTRACloud && cloudReady && cloudConversation) {
        try {
          await window.ASTRACloud.appendMessages(cloudConversation, [
            { role: "assistant", content: reply, sequence_no: assistantSequence }
          ]);
          await refreshCloudArchive();
        } catch (saveError) {
          if (status) status.textContent = "CLOUD SAVE ISSUE · " + (saveError.message || "RETRY LATER");
        }
      }
      if (window.ASTRAMemory) {
        if (!cloudReady) {
          window.ASTRAMemory.saveCurrentMessages(history);
          renderArchive();
        }
        const learned = Array.isArray(data.memoryUpdates) ? data.memoryUpdates : [];
        if (learned.length) {
          window.ASTRAMemory.addMemories(learned);
          renderMemories();
          if (memoryNotice) memoryNotice.textContent = "ASTRA updated its memory from this conversation.";
        }
      }
    } catch (error) {
      if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.saveCurrentMessages(history);
      if (status) status.textContent = "CONNECTION ISSUE";
      typing.remove();
      addMessage(
        error.message || "Connection interrupted. Please try again.",
        "bot"
      );
    } finally {
      busy = false;
      input.disabled = false;

      if (sendButton) {
        sendButton.disabled = false;
        sendButton.textContent = "↑";
        sendButton.setAttribute("aria-label", "Send message");
      }
      input.placeholder = "Ask ASTRA anything…";
      input.focus();
    }
  }


  // Message-level actions are available only on the user's own messages.
  chat.addEventListener("click", async event => {
    const action = event.target.closest("[data-message-action]");
    if (!action || busy) return;
    event.stopPropagation();
    const index = Number(action.dataset.messageIndex);
    const message = history[index];
    if (!Number.isInteger(index) || !message || message.role !== "user") return;
    const operation = action.dataset.messageAction;
    const content = message.content;

    if (operation === "share") {
      try {
        if (navigator.share) await navigator.share({ title: "My message to ASTRA", text: content });
        else {
          await navigator.clipboard.writeText(content);
          if (status) status.textContent = "MESSAGE COPIED · READY TO SHARE";
        }
      } catch (error) {
        if (error.name !== "AbortError" && status) status.textContent = "SHARE UNAVAILABLE · " + (error.message || "TRY COPYING");
      }
      return;
    }

    if (operation === "edit") {
      const updated = window.prompt("Edit your message. ASTRA will answer again from this point:", content);
      if (updated === null) return;
      const clean = updated.trim();
      if (!clean) { if (status) status.textContent = "MESSAGE CANNOT BE EMPTY"; return; }
      if (clean === content) return;
      try {
        if (cloudReady && cloudConversation) {
          await window.ASTRACloud.deleteMessagesFromSequence(cloudConversation.id, index);
        }
        history = history.slice(0, index);
        if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.saveCurrentMessages(history);
        chat.querySelectorAll(".astra-message").forEach(node => node.remove());
        history.forEach((item, i) => addMessage(item.content, item.role === "user" ? "user" : "bot", i));
        if (welcome) welcome.hidden = true;
        await send(clean);
      } catch (error) {
        if (status) status.textContent = "EDIT FAILED · " + (error.message || "PLEASE RETRY");
      }
      return;
    }

    if (operation === "delete") {
      if (!window.confirm("Delete this message and everything after it in this conversation? This keeps the chat in context order.")) return;
      try {
        if (cloudReady && cloudConversation) {
          await window.ASTRACloud.deleteMessagesFromSequence(cloudConversation.id, index);
        }
        history = history.slice(0, index);
        if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.saveCurrentMessages(history);
        chat.querySelectorAll(".astra-message").forEach(node => node.remove());
        history.forEach((item, i) => addMessage(item.content, item.role === "user" ? "user" : "bot", i));
        if (welcome) welcome.hidden = history.length > 0;
        if (status) status.textContent = "MESSAGE AND FOLLOWING REPLIES DELETED";
      } catch (error) {
        if (status) status.textContent = "DELETE FAILED · " + (error.message || "PLEASE RETRY");
      }
    }
  });

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
    newChat.addEventListener("click", async () => {
      if (busy) return;

      newChat.disabled = true;
      try {
        let nextCloudConversation = null;
        if (window.ASTRACloud && cloudReady) {
          nextCloudConversation = await window.ASTRACloud.createConversation("New conversation");
        }

        history = [];
        cloudConversation = nextCloudConversation;
        if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.createConversation();
        chat.querySelectorAll(".astra-message").forEach(message => message.remove());
        if (welcome) welcome.hidden = false;
        input.value = "";
        renderArchive();
        input.focus();
      } catch (error) {
        if (status) status.textContent = "NEW CHAT ISSUE · " + (error.message || "PLEASE TRY AGAIN");
      } finally {
        newChat.disabled = false;
      }
    });
  }

  // Searchable conversation archive (stored locally on this device).
  const archiveSearch = document.getElementById("astraArchiveSearch");
  const archiveList = document.getElementById("astraArchiveList");

  function renderArchive() {
    if (!archiveList) return;
    if (cloudReady) {
      refreshCloudArchive().catch(error => {
        if (status) status.textContent = "CLOUD ARCHIVE ISSUE · " + (error.message || "RETRY LATER");
      });
      return;
    }
    if (!window.ASTRAMemory) return;
    const query = archiveSearch ? archiveSearch.value : "";
    const conversations = window.ASTRAMemory.searchConversations(query);
    archiveList.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "archive-empty";
      empty.textContent = query ? "No matching conversations." : "Your conversations will appear here.";
      archiveList.appendChild(empty);
      return;
    }
    conversations.forEach(item => {
      if (item.id === window.ASTRAMemory.getCurrentConversationId() && !item.messages.length) return;
      archiveList.appendChild(createArchiveRow(item, false));
    });
  }

  if (archiveSearch) archiveSearch.addEventListener("input", renderArchive);
  if (archiveList) archiveList.addEventListener("click", event => {
    const button = event.target.closest("[data-conversation-id]");
    if (!button || busy || !window.ASTRAMemory) return;
    const restored = window.ASTRAMemory.openConversation(button.dataset.conversationId);
    if (!restored) return;
    history = restored;
    chat.querySelectorAll(".astra-message").forEach(message => message.remove());
    history.slice(-100).forEach((item, offset) => {
      const index = history.length - Math.min(history.length, 100) + offset;
      addMessage(item.content, item.role === "user" ? "user" : "bot", index);
    });
    if (welcome) welcome.hidden = history.length > 0;
    renderArchive();
    input.focus();
  });

  renderArchive();

  if (archiveList) archiveList.addEventListener("click", async event => {
    const button = event.target.closest("[data-cloud-conversation-id]");
    if (!button || busy || !window.ASTRACloud) return;
    try {
      cloudConversation = (await window.ASTRACloud.listConversations())
        .find(item => item.id === button.dataset.cloudConversationId) || null;
      if (!cloudConversation) return;
      history = await window.ASTRACloud.loadMessages(cloudConversation.id);
      chat.querySelectorAll(".astra-message").forEach(message => message.remove());
      history.slice(-100).forEach((item, offset) => {
        const index = history.length - Math.min(history.length, 100) + offset;
        addMessage(item.content, item.role === "user" ? "user" : "bot", index);
      });
      if (welcome) welcome.hidden = history.length > 0;
      await refreshCloudArchive();
    } catch (error) {
      if (status) status.textContent = error.message || "CLOUD ARCHIVE ERROR";
    }
    input.focus();
  });

  window.addEventListener("astra-auth-ready", event => {
    signedIn = !!event.detail?.user;
    if (signedIn) initializeCloudArchive();
  });
  window.addEventListener("astra-auth-changed", event => {
    signedIn = !!event.detail?.user;
    if (signedIn) initializeCloudArchive();
    else {
      cloudReady = false;
      cloudConversation = null;
      history = [];
      chat.querySelectorAll(".astra-message").forEach(message => message.remove());
      if (welcome) welcome.hidden = false;
      if (status) status.textContent = "SIGN IN REQUIRED";
    }
  });
  // Authentication bootstrap emits astra-auth-ready after restoring the saved session.

  // Conversation actions live inside each archive row's contextual menu.
  function messagesToText(messages) {
    return (messages || []).map(item => (item.role === "user" ? "YOU" : "ASTRA") + ":\\n" + item.content).join("\\n\\n");
  }

  if (archiveList) archiveList.addEventListener("click", async event => {
    const action = event.target.closest("[data-chat-action]");
    if (!action) return;
    event.stopPropagation();
    if (busy) return;
    const id = action.dataset.chatId;
    const isCloud = action.dataset.cloud === "true";
    const operation = action.dataset.chatAction;
    action.disabled = true;
    try {
      let item, messages;
      if (isCloud) {
        item = (await window.ASTRACloud.listConversations()).find(entry => entry.id === id);
        if (!item) throw new Error("Conversation not found.");
        if (operation === "share") messages = await window.ASTRACloud.loadMessages(id);
      } else {
        item = window.ASTRAMemory.getConversations().find(entry => entry.id === id);
        if (!item) throw new Error("Conversation not found.");
        messages = item.messages;
      }
      if (operation === "edit") {
        const nextTitle = window.prompt("Rename conversation:", item.title || "Conversation");
        if (nextTitle === null) return;
        const clean = nextTitle.trim().replace(/\\s+/g, " ").slice(0, 90);
        if (!clean) { if (status) status.textContent = "NAME CANNOT BE EMPTY"; return; }
        if (isCloud) await window.ASTRACloud.renameConversation(id, clean);
        else {
          const localData = window.ASTRAMemory.getConversations().find(entry => entry.id === id);
          if (localData) {
            const key = "astralore.astra.memory.v1";
            const data = JSON.parse(localStorage.getItem(key) || "{}");
            const target = (data.conversations || []).find(entry => entry.id === id);
            if (target) { target.title = clean; localStorage.setItem(key, JSON.stringify(data)); }
          }
        }
        if (status) status.textContent = "CONVERSATION RENAMED";
      } else if (operation === "share") {
        const content = messagesToText(messages);
        if (!content) { if (status) status.textContent = "NOTHING TO SHARE YET"; return; }
        if (navigator.share) await navigator.share({ title: item.title || "ASTRA conversation", text: content });
        else {
          await navigator.clipboard.writeText(content);
          if (status) status.textContent = "CHAT COPIED · READY TO SHARE";
        }
      } else if (operation === "delete") {
        if (!window.confirm("Delete this conversation permanently? This cannot be undone.")) return;
        if (isCloud) {
          await window.ASTRACloud.deleteConversation(id);
          if (cloudConversation?.id === id) {
            cloudConversation = await window.ASTRACloud.createConversation("New conversation");
            history = [];
            chat.querySelectorAll(".astra-message").forEach(message => message.remove());
            if (welcome) welcome.hidden = false;
          }
          await refreshCloudArchive();
        } else {
          window.ASTRAMemory.deleteConversation(id);
          if (window.ASTRAMemory.getCurrentConversationId() !== id && !window.ASTRAMemory.getConversations().some(entry => entry.id === window.ASTRAMemory.getCurrentConversationId())) {
            window.ASTRAMemory.createConversation();
          }
          if (id === action.closest(".archive-row")?.querySelector("[data-conversation-id]")?.dataset.conversationId) {
            history = window.ASTRAMemory.getCurrentMessages();
            chat.querySelectorAll(".astra-message").forEach(message => message.remove());
            history.forEach(entry => addMessage(entry.content, entry.role === "user" ? "user" : "bot"));
            if (welcome) welcome.hidden = history.length > 0;
          }
          renderArchive();
        }
        if (status) status.textContent = "CONVERSATION DELETED";
      }
    } catch (error) {
      if (status) status.textContent = "CHAT ACTION FAILED · " + (error.message || "PLEASE RETRY");
    } finally {
      action.disabled = false;
    }
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".archive-row")) {
      archiveList?.querySelectorAll(".archive-menu").forEach(menu => { menu.hidden = true; });
      archiveList?.querySelectorAll(".archive-more").forEach(button => button.setAttribute("aria-expanded","false"));
    }
  });

  // Persistent light/dark appearance preference.
  const themeToggle = document.getElementById("astraThemeToggle");
  function applyTheme(theme) {
    const selected = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = selected;
    if (themeToggle) {
      themeToggle.textContent = selected === "dark" ? "LIGHT MODE" : "DARK MODE";
      themeToggle.setAttribute("aria-pressed", selected === "light" ? "true" : "false");
    }
    try { localStorage.setItem("astralore.astra.theme", selected); } catch {}
  }
  let initialTheme = "dark";
  try { initialTheme = localStorage.getItem("astralore.astra.theme") || "dark"; } catch {}
  applyTheme(initialTheme);
  if (themeToggle) themeToggle.addEventListener("click", () => {
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });

  // User-controlled, device-only memory controls.
  const memoryButton = document.getElementById("astraMemoryButton");
  const memoryDialog = document.getElementById("astraMemoryDialog");
  const memoryList = document.getElementById("astraMemoryList");
  const memoryNotice = document.getElementById("astraMemoryNotice");

  function renderMemories() {
    if (!memoryList || !window.ASTRAMemory) return;
    memoryList.replaceChildren();
    const memories = window.ASTRAMemory.getMemories();
    if (!memories.length) {
      const empty = document.createElement("p");
      empty.className = "memory-empty";
      empty.textContent = "ASTRA hasn't learned any long-term memories yet. Keep chatting naturally; useful details will be saved automatically.";
      memoryList.appendChild(empty);
      return;
    }
    memories.forEach(item => {
      const row = document.createElement("div");
      row.className = "astra-memory-item";
      const content = document.createElement("span");
      content.textContent = item.text;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove saved memory");
      remove.dataset.memoryRemove = item.id;
      row.append(content, remove);
      memoryList.appendChild(row);
    });
  }

  if (memoryButton && memoryDialog) {
    memoryButton.addEventListener("click", () => {
      renderMemories();
      if (typeof memoryDialog.showModal === "function") memoryDialog.showModal();
      else memoryDialog.setAttribute("open", "");
    });
  }

  if (memoryList) {
    memoryList.addEventListener("click", event => {
      const button = event.target.closest("[data-memory-remove]");
      if (!button || !window.ASTRAMemory) return;
      window.ASTRAMemory.removeMemory(button.dataset.memoryRemove);
      renderMemories();
      if (memoryNotice) memoryNotice.textContent = "Memory removed from this device.";
    });
  }

  const clearMemoryButton = document.getElementById("astraClearMemories");
  if (clearMemoryButton) {
    clearMemoryButton.addEventListener("click", () => {
      if (!window.ASTRAMemory || !window.ASTRAMemory.getMemories().length) return;
      if (!window.confirm("Delete all saved ASTRA memories from this device?")) return;
      window.ASTRAMemory.clearMemories();
      renderMemories();
      if (memoryNotice) memoryNotice.textContent = "All saved memories were deleted from this device.";
    });
  }

  if (API_URL) {
    if (status) status.textContent = "READY TO CONNECT";
  } else {
    if (status) status.textContent = "OFFLINE";
  }
})();
