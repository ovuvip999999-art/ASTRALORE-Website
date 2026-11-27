/* ASTRA memory + conversation archive.
 * Device-local storage for this no-login stage. */
(() => {
  "use strict";
  const KEY = "astralore.astra.memory.v1";
  const MAX_MEMORIES = 40;
  const MAX_CONVERSATIONS = 100;
  const MAX_MESSAGES = 500;
  const MAX_TEXT = 240;

  function validMessages(items) {
    return Array.isArray(items)
      ? items.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-MAX_MESSAGES)
      : [];
  }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "{}");
      let conversations = Array.isArray(value.conversations)
        ? value.conversations.filter(x => x && typeof x.id === "string").map(x => ({
            id: x.id,
            title: typeof x.title === "string" ? x.title.slice(0, 90) : "Conversation",
            messages: validMessages(x.messages),
            createdAt: x.createdAt || new Date().toISOString(),
            updatedAt: x.updatedAt || x.createdAt || new Date().toISOString()
          })).slice(-MAX_CONVERSATIONS)
        : [];
      // Migrate the previous single-chat format without discarding its messages.
      if (!conversations.length && Array.isArray(value.history) && value.history.length) {
        const messages = validMessages(value.history);
        conversations = [{
          id: "migrated-" + Date.now().toString(36),
          title: titleFrom(messages),
          messages,
          createdAt: value.updatedAt || new Date().toISOString(),
          updatedAt: value.updatedAt || new Date().toISOString()
        }];
      }
      let currentConversationId = typeof value.currentConversationId === "string"
        ? value.currentConversationId : "";
      if (!conversations.some(x => x.id === currentConversationId)) {
        currentConversationId = conversations[conversations.length - 1]?.id || "";
      }
      return {
        memories: Array.isArray(value.memories)
          ? value.memories.filter(x => x && typeof x.id === "string" && typeof x.text === "string").slice(0, MAX_MEMORIES)
          : [],
        conversations,
        currentConversationId
      };
    } catch {
      return { memories: [], conversations: [], currentConversationId: "" };
    }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: 3,
        memories: data.memories.slice(0, MAX_MEMORIES),
        conversations: data.conversations.slice(-MAX_CONVERSATIONS),
        currentConversationId: data.currentConversationId,
        updatedAt: new Date().toISOString()
      }));
      return true;
    } catch { return false; }
  }

  function titleFrom(messages) {
    const first = (messages || []).find(x => x.role === "user" && x.content.trim());
    return first ? first.content.trim().replace(/\s+/g, " ").slice(0, 64) : "New conversation";
  }

  function getMemories() { return read().memories; }
  function addMemories(items) {
    if (!Array.isArray(items)) return 0;
    const data = read();
    let added = 0;
    for (const raw of items.slice(0, 3)) {
      const clean = String(raw || "").trim().replace(/\s+/g, " ").replace(/[<>]/g, "").slice(0, MAX_TEXT);
      if (!clean) continue;
      const existing = data.memories.findIndex(item => item.text.toLowerCase() === clean.toLowerCase());
      if (existing >= 0) { data.memories[existing].updatedAt = new Date().toISOString(); continue; }
      data.memories.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: clean, createdAt: new Date().toISOString() });
      added++;
    }
    data.memories = data.memories.slice(0, MAX_MEMORIES);
    write(data);
    return added;
  }
  function removeMemory(id) {
    const data = read(); data.memories = data.memories.filter(x => x.id !== id); return write(data);
  }
  function clearMemories() { const data = read(); data.memories = []; return write(data); }

  function ensureConversation() {
    const data = read();
    if (data.currentConversationId) return data.currentConversationId;
    const now = new Date().toISOString();
    const item = { id: "chat-" + Date.now().toString(36), title: "New conversation", messages: [], createdAt: now, updatedAt: now };
    data.conversations.push(item);
    data.currentConversationId = item.id;
    write(data);
    return item.id;
  }
  function getConversations() {
    return read().conversations.slice().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function getCurrentConversationId() { return ensureConversation(); }
  function getCurrentMessages() {
    const data = read();
    const item = data.conversations.find(x => x.id === data.currentConversationId);
    return item ? item.messages : [];
  }
  function saveCurrentMessages(messages) {
    const data = read();
    let item = data.conversations.find(x => x.id === data.currentConversationId);
    if (!item) {
      const now = new Date().toISOString();
      item = { id: "chat-" + Date.now().toString(36), title: "New conversation", messages: [], createdAt: now, updatedAt: now };
      data.conversations.push(item);
      data.currentConversationId = item.id;
    }
    item.messages = validMessages(messages);
    item.title = titleFrom(item.messages);
    item.updatedAt = new Date().toISOString();
    data.conversations = data.conversations.slice(-MAX_CONVERSATIONS);
    return write(data);
  }
  function createConversation() {
    const data = read();
    const now = new Date().toISOString();
    const item = { id: "chat-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), title: "New conversation", messages: [], createdAt: now, updatedAt: now };
    data.conversations.push(item);
    data.conversations = data.conversations.slice(-MAX_CONVERSATIONS);
    data.currentConversationId = item.id;
    write(data);
    return item.id;
  }
  function openConversation(id) {
    const data = read();
    if (!data.conversations.some(x => x.id === id)) return null;
    data.currentConversationId = id;
    write(data);
    return data.conversations.find(x => x.id === id).messages;
  }
  function searchConversations(query) {
    const q = String(query || "").trim().toLowerCase();
    return getConversations().filter(item => !q || item.title.toLowerCase().includes(q) ||
      item.messages.some(m => m.content.toLowerCase().includes(q)));
  }
  function deleteConversation(id) {
    const data = read();
    data.conversations = data.conversations.filter(x => x.id !== id);
    if (data.currentConversationId === id) data.currentConversationId = data.conversations[0]?.id || "";
    return write(data);
  }
  // Backwards-compatible aliases for older page builds.
  function getHistory() { return getCurrentMessages(); }
  function saveHistory(items) { return saveCurrentMessages(items); }
  function clearHistory() { return saveCurrentMessages([]); }

  window.ASTRAMemory = Object.freeze({
    getMemories, addMemories, removeMemory, clearMemories,
    getHistory, saveHistory, clearHistory,
    ensureConversation, getConversations, getCurrentConversationId,
    getCurrentMessages, saveCurrentMessages, createConversation,
    openConversation, searchConversations, deleteConversation
  });
})();