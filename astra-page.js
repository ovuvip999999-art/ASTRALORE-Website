
/* ASTRA V15 — Dedicated AI page */
(() => {
  const form = document.getElementById("astraForm");
  const input = document.getElementById("astraInput");
  const chat = document.getElementById("astraChat");
  const welcome = document.getElementById("astraWelcome");
  const suggestions = document.getElementById("astraSuggestions");
  const status = document.getElementById("astraStatus");
  const newChat = document.getElementById("newChat");
  const documentEditorButton = document.getElementById("astraDocumentEditorButton");

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
  let activeAttachment = null;
  let currentDocument = null;
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


  function addMessage(text, who, messageIndex = null, attachmentInfo = null) {
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
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "astra-message-export";
      exportButton.textContent = "DOWNLOAD AS PDF";
      exportButton.addEventListener("click", async () => {
        exportButton.disabled = true;
        exportButton.textContent = "PREPARING PDF…";
        try {
          await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js", "jspdf");
          const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
          if (!JsPDF) throw new Error("PDF export library is unavailable.");
          const pdf = new JsPDF({ unit: "mm", format: "a4" });
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          const plainText = String(text)
            .replace(/```[a-z0-9_-]*\n?/gi, "")
            .replace(/`/g, "")
            .replace(/^#{1,6}\s*/gm, "")
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/\*(.*?)\*/g, "$1")
            .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)");
          const paragraphs = plainText.split("\n");
          let y = 16;
          pdf.setFontSize(15);
          pdf.text("ASTRA · ASTRALORE", 15, y);
          y += 10;
          pdf.setFontSize(10);
          for (const paragraph of paragraphs) {
            const lines = pdf.splitTextToSize(paragraph || " ", 180);
            for (const line of lines) {
              if (y > 280) { pdf.addPage(); y = 16; }
              pdf.text(line, 15, y);
              y += 5;
            }
            y += 2;
          }
          pdf.save("ASTRA-Document-" + new Date().toISOString().slice(0, 10) + ".pdf");
          exportButton.textContent = "PDF DOWNLOADED";
          if (status) status.textContent = "PDF EXPORTED";
        } catch (error) {
          exportButton.textContent = "PDF EXPORT FAILED";
          if (status) status.textContent = error.message || "PDF EXPORT FAILED";
        } finally {
          exportButton.disabled = false;
        }
      });
      content.appendChild(exportButton);
    } else {
      const archivedAttachment = String(text).match(/\[(Image|File) attached: ([^\]]+)\]$/);
      const visibleText = archivedAttachment
        ? String(text).slice(0, archivedAttachment.index).trim()
        : String(text);
      content.textContent = visibleText;
      const attachment = attachmentInfo || (archivedAttachment
        ? { kind: archivedAttachment[1].toLowerCase() === "image" ? "image" : "document", name: archivedAttachment[2] }
        : null);
      if (who === "user" && attachment) {
        if (attachment.kind === "image" && attachment.dataUrl) {
          const image = document.createElement("img");
          image.className = "astra-user-attachment";
          image.src = attachment.dataUrl;
          image.alt = "Image attached: " + attachment.name;
          content.appendChild(image);
        } else {
          const fileChip = document.createElement("div");
          fileChip.className = "astra-user-file-attachment";
          const fileIcon = document.createElement("span");
          fileIcon.className = "astra-user-file-icon";
          fileIcon.textContent = attachment.name.toLowerCase().endsWith(".pdf") ? "PDF" : "FILE";
          const fileDetails = document.createElement("span");
          fileDetails.className = "astra-user-file-details";
          const fileName = document.createElement("strong");
          fileName.textContent = attachment.name;
          const fileType = document.createElement("small");
          fileType.textContent = "Attached document";
          fileDetails.append(fileName, fileType);
          fileChip.append(fileIcon, fileDetails);
          content.appendChild(fileChip);
        }
      }
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

  async function askAstra(question, attachment = null) {
    if (!signedIn) throw new Error("Sign in to use ASTRA.");
    if (!API_URL) throw new Error("ASTRA's live connection is not configured.");

    const sessionResult = window.ASTRASupabase ? await window.ASTRASupabase.auth.getSession() : { data: { session: null } };
    const accessToken = sessionResult.data?.session?.access_token;
    let storedOriginalPath = attachment?.storagePath || null;
    if (attachment?.kind === "document" && attachment.originalFile &&
        attachment.mimeType === "application/pdf" && window.ASTRASupabase && cloudConversation?.id) {
      try {
        const userResult = await window.ASTRASupabase.auth.getUser();
        const userId = userResult.data?.user?.id;
        if (userId) {
          const safeName = attachment.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-100);
          storedOriginalPath = userId + "/" + cloudConversation.id + "/" + crypto.randomUUID() + "-" + safeName;
          const upload = await window.ASTRASupabase.storage
            .from("astra-original-documents")
            .upload(storedOriginalPath, attachment.originalFile, {
              contentType: "application/pdf", upsert: false
            });
          if (upload.error) throw upload.error;
          attachment.storagePath = storedOriginalPath;
          if (currentDocument?.name === attachment.name) currentDocument.storagePath = storedOriginalPath;
        }
      } catch (storageError) {
        storedOriginalPath = null;
        if (status) status.textContent = "PDF ORIGINAL NOT CLOUD-SAVED · APPLY STORAGE SETUP";
      }
    }
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { "Authorization": "Bearer " + accessToken } : {})
      },
      body: JSON.stringify({
        message: question,
        image: attachment?.kind === "image" ? { name: attachment.name, mimeType: attachment.mimeType, data: attachment.dataUrl.split(",")[1] } : null,
        document: attachment?.kind === "document" ? { name: attachment.name, mimeType: attachment.mimeType, text: attachment.text, ...(storedOriginalPath ? { storagePath: storedOriginalPath } : {}) } : null,
        history: history.slice(-9, -1),
        memory: window.ASTRAMemory ? window.ASTRAMemory.getMemories().map(item => item.text) : [],
        conversationId: cloudConversation?.id || null
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

  async function sendDocumentAction(operation, documentData = null) {
    if (!signedIn || !cloudReady || !cloudConversation?.id) {
      await initializeCloudArchive();
    }
    if (!cloudConversation?.id || !API_URL) throw new Error("Open a signed-in cloud conversation first.");
    const sessionResult = await window.ASTRASupabase.auth.getSession();
    const accessToken = sessionResult.data?.session?.access_token;
    if (!accessToken) throw new Error("Your session expired. Sign in again.");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + accessToken },
      body: JSON.stringify({
        conversationId: cloudConversation.id,
        documentAction: { operation, ...(documentData ? { document: documentData } : {}) }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Document storage request failed.");
    return data;
  }

  async function openDocumentEditor() {
    if (!signedIn) throw new Error("Sign in to edit cloud documents.");
    if (!cloudReady) await initializeCloudArchive();
    if (!cloudConversation?.id) throw new Error("No active cloud conversation is available.");
    if (currentDocument && !currentDocument.conversationId) {
      currentDocument = { ...currentDocument, conversationId: cloudConversation.id };
    }
    let documentData = currentDocument?.conversationId === cloudConversation.id ? currentDocument : null;
    if (!documentData) {
      const result = await sendDocumentAction("load");
      documentData = result.document;
      if (!documentData) {
        if (status) status.textContent = "NO SAVED DOCUMENT IN THIS CONVERSATION";
        return;
      }
      currentDocument = { ...documentData, conversationId: cloudConversation.id };
      if (status) status.textContent = "DOCUMENT RESTORED · " + String(documentData.name).slice(0, 48);
    }
    if (!window.ASTRADocumentEditor) throw new Error("The document editor did not load. Refresh and try again.");
    window.ASTRADocumentEditor.open({ ...documentData, originalFile: currentDocument?.originalFile || null }, async updatedDocument => {
      const result = await sendDocumentAction("save", {
        name: updatedDocument.name,
        mimeType: updatedDocument.mimeType,
        text: updatedDocument.text,
        storagePath: updatedDocument.storagePath || currentDocument?.storagePath || null,
        editorState: updatedDocument.editorState || { annotations: [] }
      });
      if (result.documentPersistenceStatus !== "SAVED") throw new Error("Cloud storage did not confirm the save.");
      currentDocument = { ...updatedDocument, conversationId: cloudConversation.id };
      if (activeAttachment?.kind === "document" && activeAttachment.name === updatedDocument.name) {
        activeAttachment.text = updatedDocument.text;
      }
      if (status) status.textContent = "DOCUMENT SAVED · " + String(updatedDocument.name).slice(0, 48);
    });
  }

  if (documentEditorButton) {
    documentEditorButton.addEventListener("click", async () => {
      documentEditorButton.disabled = true;
      try {
        await openDocumentEditor();
      } catch (error) {
        if (status) status.textContent = "DOCUMENT EDITOR · " + String(error?.message || error).slice(0, 100);
      } finally {
        documentEditorButton.disabled = false;
      }
    });
  }

  const fileInput = document.getElementById("astraFileInput");
  const attachButton = document.getElementById("astraAttachButton");
  const attachmentPreview = document.getElementById("astraAttachmentPreview");
  const attachmentThumb = document.getElementById("astraAttachmentThumb");
  const attachmentName = document.getElementById("astraAttachmentName");
  const attachmentKind = document.getElementById("astraAttachmentKind");
  const removeAttachment = document.getElementById("astraRemoveAttachment");
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_EXTRACTED_CHARS = 50000;
  let lastPdfDiagnostic = null;

  function clearAttachment() {
    activeAttachment = null;
    if (fileInput) fileInput.value = "";
    if (attachmentPreview) attachmentPreview.hidden = true;
    if (attachmentThumb) { attachmentThumb.hidden = true; attachmentThumb.removeAttribute("src"); }
  }
  function loadScriptOnce(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-astra-lib="' + globalName + '"]');
      const script = existing || document.createElement("script");
      if (!existing) {
        script.src = src;
        script.async = true;
        script.dataset.astraLib = globalName;
        document.head.appendChild(script);
      }
      script.addEventListener("load", () => window[globalName] ? resolve(window[globalName]) : reject(new Error("Document library failed to initialise.")), { once: true });
      script.addEventListener("error", () => reject(new Error("Could not load the document reader. Check your internet connection.")), { once: true });
    });
  }

  async function extractDocument(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv")) {
      return await file.text();
    }
    if (lower.endsWith(".pdf") || file.type === "application/pdf") {
      lastPdfDiagnostic = null;
      const pdfjs = await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "pdfjsLib");
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const pageLimit = Math.min(pdf.numPages, 40);
      const pages = [];
      for (let pageNo = 1; pageNo <= pageLimit; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const textItems = content.items
          .filter(item => item.str && item.str.trim())
          .map(item => ({
            text: item.str.trim(),
            x: item.transform[4],
            y: item.transform[5],
            height: Math.abs(item.transform[3]) || 10,
            width: item.width || 0
          }))
          .sort((a, b) => b.y - a.y || a.x - b.x);

        const lines = [];

        for (const item of textItems) {
          let line = lines.find(
            existing => Math.abs(existing.y - item.y) <=
              Math.max(2, Math.min(existing.height, item.height) * 0.35)
          );

          if (!line) {
            line = { y: item.y, height: item.height, items: [] };
            lines.push(line);
          }

          line.items.push(item);
        }

        lines.sort((a, b) => b.y - a.y);

        const pageText = lines.map(line => {
          line.items.sort((a, b) => a.x - b.x);
          let result = "";
          let previousEnd = null;

          for (const item of line.items) {
            if (previousEnd !== null) {
              const gap = item.x - previousEnd;
              result += gap > 24 ? " | " : gap > 5 ? " " : "";
            }
            result += item.text;
            previousEnd = item.x + item.width;
          }

          return result;
        }).join("\n");

        pages.push("[Page " + pageNo + "]\n" + pageText);
        if (pages.join("\n").length >= MAX_EXTRACTED_CHARS) break;
      }
      if (pdf.numPages > pageLimit) pages.push("[Only the first " + pageLimit + " pages were extracted.]");
      const extractedText = pages.join("\n").slice(0, MAX_EXTRACTED_CHARS);
      const meaningful = extractedText.replace(/\[Page \d+\]/g, "").replace(/\s/g, "");
      const readable = (meaningful.match(/[\p{L}\p{N}\p{P}]/gu) || []).length;
      const replacementChars = (meaningful.match(/\uFFFD/g) || []).length;
      const readableRatio = meaningful.length ? readable / meaningful.length : 0;
      if (meaningful.length < 40 || readableRatio < 0.58 || replacementChars / Math.max(1, meaningful.length) > 0.01) {
        const report = {
          pdfjs: { status: "READY", version: pdfjs.version || "unknown", pageCount: pdf.numPages },
          textLayer: { status: "LOW_QUALITY", charCount: meaningful.length, readableRatio: Number(readableRatio.toFixed(3)), replacementChars },
          ocr: { library: "Tesseract.js", status: "PENDING", language: "eng", renderScale: 2.5, passes: ["AUTO", "SPARSE_TEXT_THRESHOLD"], pagesRendered: 0, pagesProcessed: 0, pages: [] },
          failureStage: null,
          error: null
        };
        if (status) status.textContent = "PDF TEXT LAYER UNREADABLE · STARTING OCR";
        let worker = null;
        let activeStage = "TESSERACT_LOAD_OR_INIT";
        const ocrPages = [];
        try {
          const Tesseract = await loadScriptOnce("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", "Tesseract");
          report.ocr.status = "LIBRARY_LOADED";
          worker = await Tesseract.createWorker("eng");
          report.ocr.status = "READY";
          const ocrLimit = Math.min(pdf.numPages, 12);

          // Build a high-contrast black-and-white variant for documents with faint
          // text, coloured backgrounds, or thin table lines. Otsu thresholding
          // chooses the cutoff from the page's own grayscale histogram.
          const makeThresholdCanvas = sourceCanvas => {
            const width = sourceCanvas.width;
            const height = sourceCanvas.height;
            const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
            const source = sourceContext.getImageData(0, 0, width, height);
            const gray = new Uint8Array(width * height);
            const histogram = new Uint32Array(256);
            for (let i = 0, p = 0; i < source.data.length; i += 4, p++) {
              const value = Math.round(
                0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2]
              );
              gray[p] = value;
              histogram[value]++;
            }

            const total = gray.length;
            let sum = 0;
            for (let i = 0; i < 256; i++) sum += i * histogram[i];
            let backgroundWeight = 0;
            let backgroundSum = 0;
            let bestVariance = -1;
            let threshold = 180;
            for (let i = 0; i < 256; i++) {
              backgroundWeight += histogram[i];
              if (!backgroundWeight) continue;
              const foregroundWeight = total - backgroundWeight;
              if (!foregroundWeight) break;
              backgroundSum += i * histogram[i];
              const meanBackground = backgroundSum / backgroundWeight;
              const meanForeground = (sum - backgroundSum) / foregroundWeight;
              const variance = backgroundWeight * foregroundWeight *
                (meanBackground - meanForeground) * (meanBackground - meanForeground);
              if (variance > bestVariance) {
                bestVariance = variance;
                threshold = i;
              }
            }

            const processed = document.createElement("canvas");
            processed.width = width;
            processed.height = height;
            const processedContext = processed.getContext("2d");
            if (!processedContext) throw new Error("Preprocessing canvas unavailable");
            const output = processedContext.createImageData(width, height);
            for (let p = 0; p < total; p++) {
              const value = gray[p] > threshold ? 255 : 0;
              const offset = p * 4;
              output.data[offset] = value;
              output.data[offset + 1] = value;
              output.data[offset + 2] = value;
              output.data[offset + 3] = 255;
            }
            processedContext.putImageData(output, 0, 0);
            return processed;
          };

          const confidenceOf = result =>
            Number.isFinite(result?.data?.confidence) ? result.data.confidence : null;
          const rawTextOf = result => String(result?.data?.text || "").trim();
          const textOf = result => {
            const words = Array.isArray(result?.data?.words)
              ? result.data.words.filter(word => word && typeof word.text === "string" && word.text.trim() && word.bbox)
              : [];
            if (!words.length) return rawTextOf(result);
            const ordered = words.map(word => ({
              text: word.text.trim(),
              x0: Number(word.bbox.x0),
              x1: Number(word.bbox.x1),
              y: (Number(word.bbox.y0) + Number(word.bbox.y1)) / 2,
              height: Math.max(1, Number(word.bbox.y1) - Number(word.bbox.y0))
            })).filter(word => Number.isFinite(word.x0) && Number.isFinite(word.x1) && Number.isFinite(word.y));
            if (!ordered.length) return rawTextOf(result);
            ordered.sort((a, b) => a.y - b.y || a.x0 - b.x0);
            const lines = [];
            for (const word of ordered) {
              let line = lines.find(item => Math.abs(item.y - word.y) <= Math.max(5, Math.min(item.height, word.height) * 0.55));
              if (!line) {
                line = { y: word.y, height: word.height, words: [] };
                lines.push(line);
              }
              line.words.push(word);
              line.y = line.words.reduce((sum, item) => sum + item.y, 0) / line.words.length;
              line.height = Math.max(line.height, word.height);
            }
            return lines.sort((a, b) => a.y - b.y).map(line => {
              const row = line.words.sort((a, b) => a.x0 - b.x0);
              let output = "";
              let previousEnd = null;
              for (const word of row) {
                if (previousEnd !== null) {
                  const gap = word.x0 - previousEnd;
                  output += gap > Math.max(24, line.height * 1.6) ? " | " : gap > 2 ? " " : "";
                }
                output += word.text;
                previousEnd = word.x1;
              }
              return output;
            }).join("\n");
          };
          const scoreOf = result => {
            if (!result) return -1;
            const confidence = confidenceOf(result);
            return confidence === null ? (textOf(result).length ? 0 : -1) : confidence;
          };

          for (let pageNo = 1; pageNo <= ocrLimit; pageNo++) {
            if (status) status.textContent = "OCR READING PAGE " + pageNo + " OF " + ocrLimit;
            const page = await pdf.getPage(pageNo);
            const viewport = page.getViewport({ scale: 2.5 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("Canvas 2D context unavailable on page " + pageNo);
            activeStage = "PAGE_RENDER";
            await page.render({ canvasContext: context, viewport }).promise;
            report.ocr.pagesRendered++;

            const attempts = [];
            let standardResult = null;
            let standardError = null;
            activeStage = "OCR_RECOGNITION";
            try {
              await worker.setParameters({ tessedit_pageseg_mode: "3" });
              standardResult = await worker.recognize(canvas);
              attempts.push({
                mode: "AUTO",
                charCount: textOf(standardResult).length,
                confidence: confidenceOf(standardResult)
              });
            } catch (error) {
              standardError = String(error?.message || error).slice(0, 180);
              attempts.push({ mode: "AUTO", error: standardError });
            }

            let enhancedResult = null;
            let enhancedError = null;
            let thresholdCanvas = null;
            try {
              thresholdCanvas = makeThresholdCanvas(canvas);
              await worker.setParameters({ tessedit_pageseg_mode: "11" });
              enhancedResult = await worker.recognize(thresholdCanvas);
              attempts.push({
                mode: "SPARSE_TEXT_THRESHOLD",
                charCount: textOf(enhancedResult).length,
                confidence: confidenceOf(enhancedResult)
              });
            } catch (error) {
              enhancedError = String(error?.message || error).slice(0, 180);
              attempts.push({ mode: "SPARSE_TEXT_THRESHOLD", error: enhancedError });
            }

            if (!standardResult && !enhancedResult) {
              throw new Error("OCR failed on page " + pageNo +
                " (AUTO: " + (standardError || "no result") +
                "; SPARSE_TEXT_THRESHOLD: " + (enhancedError || "no result") + ")");
            }

            const selected = scoreOf(enhancedResult) > scoreOf(standardResult)
              ? enhancedResult
              : standardResult;
            const pageText = textOf(selected);
            const confidence = confidenceOf(selected);
            report.ocr.pagesProcessed++;
            report.ocr.pages.push({
              page: pageNo,
              charCount: pageText.length,
              confidence,
              selectedPass: selected === enhancedResult ? "SPARSE_TEXT_THRESHOLD" : "AUTO",
              attempts
            });
            if (pageText) {
              const qualityLabel = confidence !== null && confidence < 60 ? " · LOW OCR CONFIDENCE · VERIFY" : "";
              ocrPages.push("[Page " + pageNo + " · OCR · confidence " + (confidence === null ? "unknown" : Math.round(confidence) + "/100") + qualityLabel + "]\n" + pageText);
            }

            if (thresholdCanvas) {
              thresholdCanvas.width = 0;
              thresholdCanvas.height = 0;
            }
            canvas.width = 0;
            canvas.height = 0;
          }
          report.ocr.status = "COMPLETED";
        } catch (error) {
          report.failureStage = activeStage;
          report.error = String(error?.message || error).slice(0, 300);
        } finally {
          if (worker) {
            try { await worker.terminate(); }
            catch (error) {
              if (!report.error) report.error = "Tesseract worker termination: " + String(error?.message || error).slice(0, 200);
            }
          }
        }

        const ocrText = ocrPages.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
        const ocrMeaningful = ocrText.replace(/\[Page [^\]]+\]/g, "").replace(/\s/g, "");
        const ocrReadable = (ocrMeaningful.match(/[\p{L}\p{N}\p{P}]/gu) || []).length;
        const ocrReadableRatio = ocrMeaningful.length ? ocrReadable / ocrMeaningful.length : 0;
        const confidences = report.ocr.pages.map(item => item.confidence).filter(Number.isFinite);
        report.ocr.averageConfidence = confidences.length
          ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(1))
          : null;
        report.ocr.totalCharacters = ocrMeaningful.length;
        report.ocr.readableRatio = Number(ocrReadableRatio.toFixed(3));
        report.ocr.pagesNotProcessed = Math.max(0, pdf.numPages - report.ocr.pagesProcessed);

        if (!report.failureStage && (ocrMeaningful.length < 40 || ocrReadableRatio < 0.70 ||
            (report.ocr.averageConfidence !== null && report.ocr.averageConfidence < 45))) {
          report.failureStage = "OCR_QUALITY_CHECK";
          report.error = "OCR completed but the extracted text did not meet readability thresholds.";
        }
        if (report.failureStage) {
          const diagnostic = JSON.stringify(report);
          throw new Error("PDF extraction failed. Diagnostic report: " + diagnostic);
        }
        // Keep successful OCR diagnostics available to the upload UI so that
        // quality can be reviewed even when extraction passes its thresholds.
        lastPdfDiagnostic = report;
        if (pdf.numPages > report.ocr.pagesProcessed) {
          ocrPages.push("[OCR processed " + report.ocr.pagesProcessed + " of " + pdf.numPages + " pages. Remaining pages were not processed.]");
        }
        return ocrPages.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
      }
      // Surface diagnostics for the normal embedded-text path too. Previously,
      // successful PDFs that bypassed OCR produced no report in the chat.
      lastPdfDiagnostic = {
        pdfjs: { status: "READY", version: pdfjs.version || "unknown", pageCount: pdf.numPages },
        textLayer: {
          status: "USED",
          charCount: meaningful.length,
          readableRatio: Number(readableRatio.toFixed(3)),
          replacementChars
        },
        ocr: { status: "NOT_RUN", reason: "Embedded PDF text passed the existing readability gate." },
        extractionPath: "PDF_TEXT_LAYER",
        totalCharacters: extractedText.length
      };
      return extractedText;
    }
    if (lower.endsWith(".docx")) {
      const mammoth = await loadScriptOnce("https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js", "mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const parsed = new DOMParser().parseFromString(result.value || "", "text/html");
      const output = [];
      const root = parsed.body;

      function collectDocumentNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName.toLowerCase();

        if (tag === "table") {
          output.push("[TABLE]");
          Array.from(node.querySelectorAll("tr")).forEach((row, rowIndex) => {
            const cells = Array.from(row.children)
              .filter(cell => ["td", "th"].includes(cell.tagName.toLowerCase()))
              .map(cell => cell.textContent.replace(/\s+/g, " ").trim());
            if (cells.length) output.push("Row " + (rowIndex + 1) + ": " + cells.join(" | "));
          });
          output.push("[/TABLE]");
          return;
        }

        if (["p", "h1", "h2", "h3", "h4", "li"].includes(tag)) {
          const value = node.textContent.replace(/\s+/g, " ").trim();
          if (value) output.push((tag.startsWith("h") ? "[" + tag.toUpperCase() + "] " : "") + value);
          return;
        }

        Array.from(node.children).forEach(collectDocumentNode);
      }

      Array.from(root.children).forEach(collectDocumentNode);
      return output.join("\n").slice(0, MAX_EXTRACTED_CHARS);
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const XLSX = await loadScriptOnce("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const output = [];
      for (const sheetName of workbook.SheetNames) {
        output.push("SHEET: " + sheetName);
        output.push(XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]));
        if (output.join("\n").length >= MAX_EXTRACTED_CHARS) break;
      }
      return output.join("\n").slice(0, MAX_EXTRACTED_CHARS);
    }
    throw new Error("Supported files: PDF, DOCX, XLSX, XLS, CSV, TXT and MD.");
  }

  if (attachButton && fileInput) {
    attachButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        if (status) status.textContent = "FILE TOO LARGE · MAXIMUM 10 MB";
        clearAttachment();
        return;
      }
      const lower = file.name.toLowerCase();
      const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
      if (isImage && file.size > 3 * 1024 * 1024) {
        if (status) status.textContent = "IMAGE TOO LARGE · MAXIMUM 3 MB";
        clearAttachment();
        return;
      }
      try {
        if (isImage) {
          const reader = new FileReader();
          reader.onload = () => {
            activeAttachment = { kind: "image", name: file.name, mimeType: file.type, dataUrl: String(reader.result) };
            if (attachmentThumb) { attachmentThumb.src = activeAttachment.dataUrl; attachmentThumb.hidden = false; }
            if (attachmentName) attachmentName.textContent = file.name;
            if (attachmentKind) attachmentKind.textContent = "Image ready · ASTRA can analyse it";
            if (attachmentPreview) attachmentPreview.hidden = false;
            if (status) status.textContent = "IMAGE READY · ASTRA CAN ANALYSE IT";
          };
          reader.onerror = () => { if (status) status.textContent = "COULD NOT READ THIS IMAGE"; };
          reader.readAsDataURL(file);
          return;
        }
        if (status) status.textContent = "READING DOCUMENT · PLEASE WAIT";
        const extracted = await extractDocument(file);
        if (!extracted.trim()) throw new Error("No readable text was found. Scanned PDFs and image-only documents need OCR, which is not available yet.");
        activeAttachment = { kind: "document", name: file.name, mimeType: file.type || "application/octet-stream", text: extracted, ...(file.type === "application/pdf" ? { originalFile: file } : {}) };
        currentDocument = { ...activeAttachment, conversationId: cloudConversation?.id || null };
        if (lastPdfDiagnostic) {
          addMessage(
            "PDF extraction diagnostics (text-layer or OCR path). Use Copy code to share this report for troubleshooting.\n\n```json\n" +
              JSON.stringify(lastPdfDiagnostic, null, 2) +
              "\n```",
            "bot"
          );
        }
        if (attachmentThumb) { attachmentThumb.hidden = true; attachmentThumb.removeAttribute("src"); }
        if (attachmentName) attachmentName.textContent = file.name;
        if (attachmentKind) attachmentKind.textContent = "Text extracted · up to " + MAX_EXTRACTED_CHARS.toLocaleString() + " characters";
        if (attachmentPreview) attachmentPreview.hidden = false;
        if (status) status.textContent = "DOCUMENT READY · ASTRA CAN READ IT";
      } catch (error) {
        clearAttachment();
        const message = String(error?.message || "COULD NOT READ THIS FILE");
        const diagnosticMarker = "Diagnostic report: ";
        const diagnosticIndex = message.indexOf(diagnosticMarker);
        if (diagnosticIndex >= 0) {
          const rawDiagnostic = message.slice(diagnosticIndex + diagnosticMarker.length);
          let formattedDiagnostic = rawDiagnostic;
          try {
            formattedDiagnostic = JSON.stringify(JSON.parse(rawDiagnostic), null, 2);
          } catch {}
          addMessage(
            "PDF extraction failed. The complete diagnostic report is below. Use the Copy code button to send it here.\n\n```json\n" +
              formattedDiagnostic +
              "\n```",
            "bot"
          );
          if (status) status.textContent = "PDF DIAGNOSTIC READY · USE COPY CODE";
        } else if (status) {
          status.textContent = message.slice(0, 120);
        }
      }
    });
  }
  if (removeAttachment) removeAttachment.addEventListener("click", clearAttachment);

  async function send(text) {
    const message = text.trim() || (activeAttachment?.kind === "image" ? "Please analyse the attached image and describe what you can see." : activeAttachment?.kind === "document" ? "Please read the attached document and summarise its contents." : "");

    if (!signedIn) {
      const accountDialog = document.getElementById("astraAccountDialog");
      if (accountDialog && !accountDialog.open && typeof accountDialog.showModal === "function") accountDialog.showModal();
      if (status) status.textContent = "SIGN IN REQUIRED";
      return;
    }
    if ((!message && !activeAttachment) || busy) return;

    // Do not send a document request until the authenticated cloud conversation is ready.
    // The auth-ready event and cloud archive initialization are asynchronous.
    if (window.ASTRACloud && window.ASTRASupabase && !cloudReady) {
      await initializeCloudArchive();
    }
    if (activeAttachment?.kind === "document" && (!cloudReady || !cloudConversation?.id)) {
      if (status) status.textContent = "CLOUD CONVERSATION NOT READY · DOCUMENT NOT SENT";
      return;
    }

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
    const attachmentForSend = activeAttachment;
    if (attachmentForSend?.kind === "document") {
      currentDocument = { ...attachmentForSend, conversationId: cloudConversation?.id || null };
    }
    const archivedMessage = message + (attachmentForSend ? (message ? "\n" : "") + "[" + (attachmentForSend.kind === "image" ? "Image" : "File") + " attached: " + attachmentForSend.name + "]" : "");
    addMessage(message, "user", userSequence, attachmentForSend);
    input.value = "";
    clearAttachment();
    resizeComposer();
    history.push({ role: "user", content: archivedMessage });
    if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.saveCurrentMessages(history);
    if (window.ASTRACloud && cloudReady && cloudConversation) {
      try {
        await window.ASTRACloud.appendMessages(cloudConversation, [
          { role: "user", content: archivedMessage, sequence_no: userSequence }
        ]);
      } catch (saveError) {
        if (status) status.textContent = "CLOUD SAVE ISSUE · " + (saveError.message || "RETRY LATER");
      }
    }

    const typing = addMessage("Receiving signal…", "bot");
    typing.classList.add("astra-message-loading");

    try {
      const data = await askAstra(message, attachmentForSend);
      const reply = data.reply;
      if (data.documentContextAvailable) {
        const state = data.documentPersistenceStatus === "SAVED" ? "SAVED" :
          data.documentPersistenceStatus === "RESTORED" ? "RESTORED" : "AVAILABLE";
        if (status) status.textContent = "DOCUMENT " + state + " · " + String(data.documentName || "ATTACHED FILE").slice(0, 48);
      } else if (data.documentPersistenceStatus === "NOT_FOUND") {
        if (status) status.textContent = "DOCUMENT NOT FOUND · REATTACH FILE";
      } else if (data.documentPersistenceStatus === "NO_CONVERSATION_ID") {
        if (status) status.textContent = "DOCUMENT NOT LINKED TO CLOUD CHAT";
      } else if (status) {
        status.textContent = "ONLINE";
      }

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
          if (status) status.textContent = "CLOUD SAVE ISSUE · " + (saveError.message || "RETRY LATER");        }
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
      input.placeholder = "Message ASTRA...";
      resizeComposer();
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

  // ChatGPT-style composer: grow with the message and send on Enter.
  function resizeComposer() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 168) + "px";
    input.style.overflowY = input.scrollHeight > 168 ? "auto" : "hidden";
  }

  input.addEventListener("input", resizeComposer);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!busy && input.value.trim()) form.requestSubmit();
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
        currentDocument = null;
        cloudConversation = nextCloudConversation;
        if (window.ASTRAMemory && !cloudReady) window.ASTRAMemory.createConversation();
        chat.querySelectorAll(".astra-message").forEach(message => message.remove());
        if (welcome) welcome.hidden = false;
        input.value = "";
        clearAttachment();
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
      currentDocument = null;
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
    return (messages || []).map(item => (item.role === "user" ? "YOU" : "ASTRA") + ":\n" + item.content).join("\n\n");
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
            history.forEach((entry, index) => addMessage(entry.content, entry.role === "user" ? "user" : "bot", index));
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