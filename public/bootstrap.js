// Independent classic entry: must run before the application module graph.
(() => {
// Run small, trusted startup repairs from an independent same-origin script so the deployed
// Content Security Policy does not need to allow inline scripts.
function renderStartupFailure(reason) {
    if (document.documentElement.dataset.whReactMounted === "true")
        return;
    const root = document.getElementById("root");
    if (!root)
        return;
    const message = reason instanceof Error
        ? reason.message
        : typeof reason === "string"
            ? reason
            : "WeHouse could not finish starting.";
    const previewConfigurationProblem = /configuration is incomplete|Supabase URL is invalid|preview configuration is missing|non-production WeHouse host cannot connect to the production Supabase project/i.test(message);
    root.replaceChildren();
    const shell = document.createElement("main");
    shell.style.cssText =
        "min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#0E0C12;color:#F6F2FC;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const card = document.createElement("section");
    card.style.cssText =
        "width:min(100%,380px);text-align:center";
    const mark = document.createElement("img");
    mark.src = "/app-icon.svg?v=3";
    mark.alt = "";
    mark.width = 46;
    mark.height = 46;
    mark.style.cssText = "display:block;margin:0 auto;border-radius:14px";
    const title = document.createElement("h1");
    title.textContent = previewConfigurationProblem
        ? "Preview backend is not connected"
        : "WeHouse could not start";
    title.style.cssText =
        "margin:18px 0 0;font-size:20px;line-height:1.25;font-weight:760;letter-spacing:-.02em";
    const body = document.createElement("p");
    body.textContent = previewConfigurationProblem
        ? "This preview is intentionally blocked from using production data. Connect a safe test Supabase environment, then reload."
        : "Check your connection, then try again.";
    body.style.cssText =
        "margin:12px auto 0;max-width:310px;color:#AAA3B3;font-size:14px;line-height:1.7";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload WeHouse";
    reload.style.cssText =
        "margin-top:24px;min-height:48px;width:100%;border:0;border-radius:12px;background:#7C3AED;color:white;font-size:14px;font-weight:600;cursor:pointer";
    reload.addEventListener("click", () => window.location.reload());
    const detail = document.createElement("p");
    detail.textContent = previewConfigurationProblem
        ? "Production remains isolated and untouched."
        : "";
    detail.style.cssText =
        "margin:14px 0 0;color:#AAA3B3;font-size:12px;line-height:1.5";
    card.append(mark, title, body, reload, detail);
    shell.append(card);
    root.append(shell);
}
window.addEventListener("error", (event) => {
    renderStartupFailure(event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
    renderStartupFailure(event.reason);
});
// If module evaluation stalls without surfacing a normal error event, never
// leave someone on an endless decorative splash.
window.setTimeout(() => {
    if (document.documentElement.dataset.whReactMounted !== "true" &&
        document.getElementById("wh-bootstrap")) {
        renderStartupFailure("WeHouse startup did not mount within the expected time.");
    }
}, 8000);
try {
    if (localStorage.getItem("wh_navpage") === "property_owner")
        localStorage.setItem("wh_navpage", "property_partner");
    if (window.history.state?.page === "property_owner")
        window.history.replaceState({ page: "property_partner" }, "", "#property_partner");
}
catch { }
if ("serviceWorker" in navigator)
    void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);

})();
