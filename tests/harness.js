// Тестовый стенд для однофайлового приложения index.html.
//
// Принцип: приложение НЕ копируется в тесты — inline-<script> извлекается
// непосредственно из index.html и выполняется в jsdom. Поэтому тесты всегда
// проверяют актуальный код страницы, а не его снимок.
//
// Окружение:
//  - jsdom 26 (Node 20);
//  - только встроенный node:test + node:assert, других зависимостей нет;
//  - часы подменяются (window.Date.now), поэтому тесты детерминированы;
//  - window.setInterval перехватывается: фоновый тик (200 мс) в тестах
//    вызывается вручную через tick();
//  - облако не настроено (нет ключа синхронизации) → CloudSync.isActive()
//    ложно, сеть в тестах не используется; fetch всё равно заглушён и
//    записывает обращения, чтобы это можно было проверить.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const REPO_ROOT = path.join(__dirname, "..");
const INDEX_PATH = process.env.INDEX_HTML
  ? path.resolve(process.env.INDEX_HTML)
  : path.join(REPO_ROOT, "index.html");

// Опорное время тестов — ближайший целый час UTC в будущем.
//
// Почему не фиксированная дата: приложение трактует «Конец» (ЧЧ:ММ) через
// Intl.DateTimeFormat.formatToParts, а форматтеры Intl НЕ обращаются к
// Date.now() — их не подменить фейковыми часами. На фиксированной дате
// «Конец» рассчитывался бы от сегодняшнего реального дня, и граница сессии
// оказывалась в прошлом (как следствие — мгновенный суточный сброс в тестах).
// Привязка T0 к реальной дате устраняет расхождение, а округление до целого
// часа в будущем делает сценарии детерминированными.
const T0 = (() => {
  const actual = Date.now();
  const nextHour = Math.floor(actual / 3_600_000) * 3_600_000 + 3_600_000;
  return nextHour > actual ? nextHour : nextHour + 3_600_000;
})();
const T0_ISO = new Date(T0).toISOString();

/** ЧЧ:ММ (UTC) момента T0 + offsetMs — для задания «Конца» в тестах. */
function hhmm(offsetMs = 0) {
  const d = new Date(T0 + offsetMs);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** «Конец» по умолчанию: через 2 часа от T0 (всегда в будущем). */
const DEFAULT_END = hhmm(2 * 3_600_000);

function readHtml(file = INDEX_PATH) {
  return fs.readFileSync(file, "utf8");
}

// Классы приложения объявлены как `class X` (let/const-подобные binding'и),
// поэтому «наружу» их отдаёт добавленный в конец <script> хвост.
function collectGlobals() {
  return [
    "APP_VERSION",
    "CLOUD_CONFIG",
    "AppState",
    "AppController",
    "AddTaskController",
    "CalculationService",
    "CloudController",
    "CloudSync",
    "EventService",
    "GroupTaskController",
    "MenuController",
    "ModalController",
    "NotificationService",
    "PriorityCalculator",
    "ProportionCalculator",
    "SessionManager",
    "SplitController",
    "StorageService",
    "TimeCalculator",
    "TimeManager",
    "Timer",
    "TimerController",
    "TimerModel",
    "TimerView",
    "TimeZoneHolder",
    "UIFactory",
    "Utils",
  ];
}

function buildHtml(html) {
  const tail =
    "\n;globalThis.__app = {" +
    collectGlobals()
      .map(name => `${JSON.stringify(name)}: typeof ${name} !== "undefined" ? ${name} : null`)
      .join(",") +
    "};\n";
  const idx = html.lastIndexOf("</script>");
  if (idx === -1) {
    throw new Error("В index.html не найден закрывающий тег </script>");
  }
  return html.slice(0, idx) + tail + html.slice(idx);
}

// Заглушки, которые должны существовать ДО выполнения кода приложения.
const PRELUDE = `
<script>
  (function () {
    var fired = [];
    window.__notifications = fired;
    function FakeNotification(title, options) {
      fired.push({ title: title, body: (options && options.body) || "" });
    }
    FakeNotification.permission = "granted";
    FakeNotification.requestPermission = function () {
      return Promise.resolve("granted");
    };
    window.Notification = FakeNotification;
    window.__fetchCalls = [];
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      window.__fetchCalls.push(args);
      return Promise.reject(new Error("network disabled in tests"));
    };
  })();
</script>
`;

function insertPrelude(html) {
  const marker = "<script>";
  const at = html.indexOf(marker);
  if (at === -1) throw new Error("В index.html не найден <script>");
  return html.slice(0, at) + PRELUDE + html.slice(at);
}

/**
 * Создаёт полностью готовое к тестам окружение приложения.
 * @param {object} [opts]
 * @param {number} [opts.now]  стартовое «серверное» время (мс epoch)
 * @param {string} [opts.html] альтернативный HTML (например, копия до правок)
 * @param {string} [opts.timezone] TZ для window (по умолчанию UTC)
 */
// Реестр всех созданных окружений: закрытие окон в конце прогона гарантирует,
// что процесс node --test завершится, даже если отдельный тест упал раньше
// своего ctx.close().
const LIVE = new Set();

function closeAll() {
  for (const ctx of [...LIVE]) {
    try {
      ctx.close();
    } catch (e) {
      /* noop */
    }
  }
  LIVE.clear();
}

function createContext(opts = {}) {
  const html = buildHtml(insertPrelude(opts.html || readHtml()));
  const virtualConsole = new VirtualConsole();
  if (process.env.VERBOSE) {
    virtualConsole.on("jsdomError", e => console.error("[jsdom]", e));
    virtualConsole.on("error", (...a) => console.error("[page]", ...a));
  } else {
    virtualConsole.on("jsdomError", () => {});
    virtualConsole.on("error", () => {});
  }
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://proptimer.test/",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const window = dom.window;

  // --- детерминированные часы -------------------------------------------
  let current = Number.isFinite(opts.now) ? opts.now : T0;
  window.Date.now = () => current;
  const clock = {
    get now() {
      return current;
    },
    at(ms) {
      current = Number(ms);
      return current;
    },
    advance(ms) {
      current += Number(ms);
      return current;
    },
    advanceSec(s) {
      return this.advance(s * 1000);
    },
    date() {
      return new Date(current);
    },
  };

  // --- фоновые интервалы не должны жить своей жизнью ---------------------
  const intervals = [];
  window.setInterval = (fn, ms) => {
    intervals.push({ fn, ms });
    return intervals.length;
  };
  window.clearInterval = () => {};

  const app = window.__app;
  if (!app) throw new Error("Код приложения не отдал globalThis.__app");
  for (const [name, value] of Object.entries(app)) {
    if (value === null) throw new Error(`Не найден глобальный объект: ${name}`);
  }

  const ctx = {
    dom,
    window,
    document: window.document,
    clock,
    intervals,
    fetchCalls: window.__fetchCalls,
    notifications: window.__notifications,
    ...app,
    // --- инициализация приложения без реальных таймеров ------------------
    init({ withDelegation = true, loadStorage = false } = {}) {
      app.TimerView.init();
      if (loadStorage) app.StorageService.loadTimersFromLocalStorage();
      if (withDelegation) app.EventService.setupEventDelegation();
      // Интервалы зарегистрированы, но не выполняются сами.
      app.AppController.setupIntervalUpdates();
      return ctx;
    },
    // Ровно одно «сердцебиение» приложения (эквивалент 200-мс тика).
    tick() {
      app.CalculationService.updateCalculations();
      return ctx;
    },
    reset() {
      window.localStorage.clear();
      app.AppState.timers = [];
      app.AppState.observers = {};
      app.AppState.globalEndTime = null;
      app.AppState.initialAvailable = 0;
      app.AppState.awayModeActive = false;
      app.AppState.autoAwayModeActive = false;
      app.AppState.awayStartTime = null;
      app.AppState.lastSessionEndTime = null;
      app.AppState.needsReset = false;
      app.AppState.lastUpdateTime = new Date(current);
      app.SessionManager.isJustAfterReset = false;
      const container = app.AppState.getTimersContainerElement();
      if (container) container.innerHTML = "";
      return ctx;
    },
    /**
     * Создаёт задачу в модели И её карточку в DOM (без autoUpdate — планы
     * остаются такими, какими их выставил тест).
     */
    addTimer(fields = {}) {
      const timer = app.TimerModel.createTimer();
      Object.assign(timer, fields);
      if (fields.name === undefined) timer.name = `Задача ${timer.id}`;
      app.AppState.addTimer(timer); // → timerAdded → карточка в DOM
      return timer;
    },
    addTimers(list) {
      return list.map(fields => ctx.addTimer(fields));
    },
    /** Пересчитать планы всех задач от настенного времени (без рекомендаций). */
    recomputePlans() {
      app.TimeManager.updateGlobalEndTimeAndPlans(null, null, false);
      return ctx;
    },
    setEndTime(value) {
      const input = app.AppState.getGlobalEndTimeElement();
      input.value = value;
      app.TimeManager.updateGlobalEndTimeAndPlans(value, null, true);
      return ctx;
    },
    card(timer) {
      return app.AppState.getTimerElement(timer.id);
    },
    cardText(timer, kind) {
      const el = ctx.elementOf(timer, kind);
      return el ? el.textContent : null;
    },
    elementOf(timer, kind) {
      const map = {
        planned: app.AppState.getTimerPlannedElement(timer.id),
        tracked: app.AppState.getTimerTrackedElement(timer.id),
        total: app.AppState.getTimerTotalElement(timer.id),
        remaining: app.AppState.getTimerRemainingElement(timer.id),
        recommendation: app.AppState.getTimerRecommendationElement(timer.id),
        priority: app.AppState.getTimerPriorityElement(timer.id),
        proportion: app.AppState.getTimerProportionElement(timer.id),
        target: app.AppState.getTimerTargetProportionElement(timer.id),
      };
      return map[kind];
    },
    click(el) {
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      return ctx;
    },
    change(el) {
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
      return ctx;
    },
    inputEvent(el) {
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
      return ctx;
    },
    cardButton(timer, text) {
      const card = ctx.card(timer);
      return [...card.querySelectorAll("button")].find(b => b.textContent === text);
    },
    globalButton(text) {
      const panel = ctx.document.getElementById("globalControls");
      return [...panel.querySelectorAll("button")].find(b => b.textContent.trim() === text);
    },
    isAway() {
      return app.AppState.isAwayModeActive();
    },
    awayStart() {
      return app.AppState.getAwayStartTime();
    },
    totalPlanned() {
      return app.AppState.getTimers().reduce((s, t) => s + (t.plannedSeconds || 0), 0);
    },
    close() {
      LIVE.delete(ctx);
      try {
        dom.window.close();
      } catch (e) {
        /* noop */
      }
    },
  };
  LIVE.add(ctx);
  return ctx;
}

/**
 * createContext + инициализация + выровненное «последнее обновление».
 * Самый частый сценарий в тестах.
 */
function setup(opts = {}) {
  const ctx = createContext(opts);
  ctx.reset();
  ctx.init({ withDelegation: opts.withDelegation !== false, loadStorage: opts.loadStorage });
  ctx.clock.at(opts.now !== undefined ? opts.now : T0);
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return ctx;
}

/**
 * Обёртка теста с гарантированным закрытием jsdom-окна: даже если проверка
 * упадёт, окно будет закрыто и процесс node --test завершится.
 */
function withCtx(name, opts, body) {
  if (typeof opts === "function") {
    body = opts;
    opts = {};
  }
  test(name, t => {
    const ctx = setup(opts);
    t.after(() => ctx.close());
    return body(ctx, t);
  });
}

module.exports = {
  withCtx,
  closeAll,
  hhmm,
  DEFAULT_END,
  INDEX_PATH,
  REPO_ROOT,
  T0,
  T0_ISO,
  readHtml,
  buildHtml,
  insertPrelude,
  createContext,
  setup,
  collectGlobals,
};
