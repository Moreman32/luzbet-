// Classic (non-module) script: if the app has not rendered within 10 s — e.g. the browser mixed stale cached
// modules with new ones — show a readable message and a one-click hard reload instead of an endless "Загрузка…".
(function () {
  var errors = [];
  window.addEventListener("error", function (e) { errors.push(String(e.message || e.error || "")); });
  window.addEventListener("unhandledrejection", function (e) { errors.push(String(e.reason && e.reason.message || e.reason || "")); });
  setTimeout(function () {
    var app = document.getElementById("app");
    if (!app || !/Загрузка…/.test(app.textContent || "") || app.querySelector(".hdr, form")) return;
    var box = document.createElement("div");
    box.className = "auth-wrap";
    var card = document.createElement("div");
    card.className = "card stack";
    card.style.maxWidth = "440px";
    var h = document.createElement("h3"); h.textContent = "Касса не открылась";
    var p = document.createElement("p"); p.className = "muted";
    p.textContent = "Скорее всего, браузер держит старую версию сайта в кэше. Нажмите кнопку — страница загрузится заново.";
    var b = document.createElement("button"); b.className = "btn primary block"; b.type = "button"; b.textContent = "Обновить сайт";
    b.onclick = function () {
      var go = function () { location.replace(location.pathname + "?r=" + Date.now() + location.hash); };
      if (window.caches && caches.keys) caches.keys().then(function (k) { return Promise.all(k.map(function (x) { return caches.delete(x); })); }).then(go, go); else go();
    };
    card.appendChild(h); card.appendChild(p); card.appendChild(b);
    if (errors.length) { var s = document.createElement("small"); s.className = "muted mono"; s.textContent = errors[0].slice(0, 300); card.appendChild(s); }
    box.appendChild(card);
    app.replaceChildren(box);
  }, 10000);
})();
