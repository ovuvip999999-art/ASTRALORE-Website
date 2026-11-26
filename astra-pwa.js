(() => {
  const installButton = document.getElementById("installAstra");
  let installPrompt = null;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButton.hidden = true;
    });
  }

  window.addEventListener("appinstalled", () => {
    if (installButton) installButton.hidden = true;
    installPrompt = null;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("/astra-sw.js", {
          scope: "/",
          updateViaCache: "none"
        });
        registration.update().catch(() => {});
      } catch (error) {
        console.warn("ASTRA app worker registration failed:", error);
      }
    });
  }
})();