/* ASTRA V2 — image studio. Model calls stay behind the authenticated Worker. */
(() => {
  "use strict";
  const openButton = document.getElementById("astraImageStudioButton");
  const dialog = document.getElementById("astraImageStudioDialog");
  const promptInput = document.getElementById("astraImagePrompt");
  const ratioInput = document.getElementById("astraImageRatio");
  const acknowledge = document.getElementById("astraImageCostAck");
  const generateButton = document.getElementById("astraImageGenerate");
  const preview = document.getElementById("astraImagePreview");
  const downloadButton = document.getElementById("astraImageDownload");
  const status = document.getElementById("astraImageStatus");
  if (!openButton || !dialog || !promptInput || !ratioInput || !acknowledge || !generateButton || !preview || !downloadButton || !status) return;

  let currentUrl = null;
  function say(message) { status.textContent = message; }
  function clearPreview() {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    preview.hidden = true;
    preview.removeAttribute("src");
    downloadButton.hidden = true;
  }

  openButton.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });

  generateButton.addEventListener("click", async () => {
    const prompt = promptInput.value.trim();
    if (prompt.length < 5 || prompt.length > 1000) {
      say("Write a prompt between 5 and 1,000 characters.");
      return;
    }
    if (!acknowledge.checked) {
      say("Please confirm you understand AI generation uses your Cloudflare AI allowance.");
      return;
    }
    if (!window.ASTRASupabase) {
      say("Sign in to your ASTRA account first.");
      return;
    }

    generateButton.disabled = true;
    clearPreview();
    say("Generating your image… this can take a little while.");
    try {
      const { data: sessionData, error: sessionError } = await window.ASTRASupabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw new Error("Your session expired. Sign in again.");
      const apiUrl = typeof window.ASTRA_API_URL === "string" ? window.ASTRA_API_URL.trim() : "";
      if (!apiUrl) throw new Error("ASTRA's AI Worker is not configured.");

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sessionData.session.access_token
        },
        body: JSON.stringify({
          creativeAction: { operation: "generate-image", prompt, aspectRatio: ratioInput.value },
          costAcknowledged: true
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Image generation failed.");
      if (typeof data.image !== "string" || !data.image) throw new Error("The image service returned no image data.");

      const encodedImage = data.image.replace(/^data:image\/png;base64,/i, "");
      const binary = atob(encodedImage);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.mimeType || "image/png" });
      currentUrl = URL.createObjectURL(blob);
      preview.src = currentUrl;
      preview.hidden = false;
      downloadButton.hidden = false;
      downloadButton.onclick = () => {
        const link = document.createElement("a");
        link.href = currentUrl;
        link.download = "astra-generated-image.png";
        document.body.appendChild(link);
        link.click();
        link.remove();
      };
      say("Image ready · " + (Number.isInteger(data.remainingToday) ? data.remainingToday + " generations left today" : "preview only"));
    } catch (error) {
      say(error.message || "Image generation failed. Please try again.");
    } finally {
      generateButton.disabled = false;
    }
  });

  dialog.addEventListener("close", clearPreview);
  window.addEventListener("beforeunload", clearPreview);
})();
