// Run small, trusted startup repairs from a same-origin module so the deployed
// Content Security Policy does not need to allow inline scripts.
try {
  if (localStorage.getItem("wh_navpage") === "property_owner")
    localStorage.setItem("wh_navpage", "property_partner");
  if (window.history.state?.page === "property_owner")
    window.history.replaceState(
      { page: "property_partner" },
      "",
      "#property_partner",
    );
} catch {}

if ("serviceWorker" in navigator)
  void navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => undefined);
