export function buildDocumentChunks(source, question) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const chunks = [];
  let current = [];
  let size = 0;

  for (const rawLine of lines) {
    const line = rawLine.slice(0, 1200);
    if (current.length && size + line.length > 2200) {
      chunks.push(current.join("\n"));
      const carry = current.slice(-2);
      current = carry;
      size = carry.reduce((total, item) => total + item.length + 1, 0);
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));

  const terms = [...new Set((String(question || "").toLowerCase().match(/[a-z]{2,}|\d+/g) || []))];
  const range = String(question || "").match(/(?:test|tests)\s*(\d+)\s*(?:-|–|—|to|through)\s*(\d+)/i);
  const requested = range
    ? Array.from({ length: Math.min(30, Math.abs(Number(range[2]) - Number(range[1])) + 1) },
        (_, index) => Math.min(Number(range[1]), Number(range[2])) + index)
    : [];

  const ranked = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (/^\d+$/.test(term)) {
        if (new RegExp("(^|\\D)" + term + "($|\\D)").test(lower)) score += 3;
      } else if (lower.includes(term)) {
        score += Math.min(lower.split(term).length - 1, 5) * 2;
      }
    }
    for (const number of requested) {
      if (new RegExp("(?:test\\s*" + number + "\\b|\\b" + number + "\\s+arjuna)", "i").test(lower)) score += 18;
    }
    return { index, chunk, score };
  });

  if (chunks.length <= 7) return { chunks: ranked.map(item => item.chunk), total: chunks.length, selected: chunks.length };

  const chosen = new Set();
  const ordered = ranked.slice().sort((a, b) => b.score - a.score || a.index - b.index);
  const limit = requested.length ? 16 : 9;
  for (const item of ordered.slice(0, limit)) {
    if (item.score <= 0 && chosen.size >= 3) break;
    chosen.add(item.index);
    if (item.index > 0) chosen.add(item.index - 1);
    if (item.index + 1 < chunks.length && item.score >= 5) chosen.add(item.index + 1);
  }
  if (!chosen.size) {
    for (let index = 0; index < Math.min(6, chunks.length); index++) chosen.add(index);
  }
  const selected = [...chosen].sort((a, b) => a - b);
  return {
    chunks: selected.map(index => "[Document section " + (index + 1) + "]\n" + chunks[index]),
    total: chunks.length,
    selected: selected.length
  };
}

