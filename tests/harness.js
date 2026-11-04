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

// Сценарии строятся от UTC-часов (hhmm() ниже возвращает ЧЧ:ММ по UTC), а
// приложение трактует «Конец» по часовому поясу процесса. На машине не в UTC
// (например, МСК) «Конец» оказывался в другой точке суток и ролловер-сценарии
// падали. Фиксируем UTC до создания любых окон (меняется только процесс тестов).
if (process.env.TZ !== "UTC") process.env.TZ = "UTC";

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
    "CreateGroupController",
    "EventService",
    "FolderView",
    "GroupTaskController",
    "MenuController",
    "ModalController",
    "MoveToGroupController",
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
    "TreeController",
    "TreeModel",
    "TreeMoveView",
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

/** Принимает сущность (таймер/узел) или её id — возвращает id. */
function idOf(x) {
  return x !== null && typeof x === "object" ? x.id : x;
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
  const missing = Object.entries(app)
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  if (missing.length && process.env.ALLOW_MISSING_GLOBALS !== "1") {
    throw new Error(`Не найден глобальный объект: ${missing[0]}`);
  }
  // A/B-режим (ALLOW_MISSING_GLOBALS=1 в паре с INDEX_HTML=<старая версия>):
  // отсутствующие классы остаются null, и падают только те тесты, которые
  // действительно проверяют новое поведение. Так видно, что остальное
  // работает ровно как раньше.

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
      // Дерево (папки и порядок) — часть состояния приложения
      app.AppState.tree = [];
      if (app.FolderView && app.FolderView.collapsedFolders) {
        app.FolderView.collapsedFolders.clear();
      }
      if (app.TimerView && app.TimerView.expandedTimers) {
        app.TimerView.expandedTimers.clear();
      }
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
      return app.AppState.getTimerElement(idOf(timer));
    },
    // --- дерево (папки, доли, перемещения) -----------------------------
    /** id карточки таймера или число — возвращает элемент карточки. */
    cardById(id) {
      return ctx.document.getElementById(`timer-${idOf(id)}`);
    },
    folderEl(folder) {
      return ctx.document.getElementById(`folder-${idOf(folder)}`);
    },
    folderChildrenEl(folder) {
      return ctx.document.getElementById(`folder-children-${idOf(folder)}`);
    },
    /** Шапка папки: в ней название, цель, доля, стрелки — но НЕ содержимое. */
    folderHeader(folder) {
      const el = ctx.folderEl(folder);
      return el ? el.querySelector(".folder-header") : null;
    },
    /** Создать папку в модели (без модалки) и вернуть её узел. */
    addFolder(name = "Папка", parentNode = null) {
      const node = app.TreeModel.createFolder(name, parentNode || null);
      app.TimerView.renderTree();
      return node;
    },
    /** Перенести узел (таймер или папку) в папку; folderId=null — в корень. */
    moveToFolder(nodeId, folderId) {
      return app.TreeController.moveToFolder(nodeId, folderId);
    },
    /** Плоский порядок дерева: [{kind,id,depth}] — как его видит пользователь. */
    flat() {
      return Array.from(
        app.TreeModel.flatten().map(x => ({
          kind: x.kind,
          id: x.id,
          depth: x.depth,
        }))
      );
    },
    /** Порядок КОРНЕВЫХ id (таймеры и папки вперемешку). */
    rootOrder() {
      return Array.from(app.TreeModel.root().map(n => Number(n.id)));
    },
    shareInput(timer) {
      return ctx.document.getElementById(`share-${idOf(timer)}`);
    },
    shareRow(timer) {
      return ctx.document.getElementById(`share-row-${idOf(timer)}`);
    },
    shareValue(timer) {
      return app.TreeModel.shareOf(idOf(timer));
    },
    moveButton(node, dir) {
      const id = idOf(node);
      const isFolder = app.TreeModel.isFolder(app.TreeModel.findNode(id).node);
      const host = isFolder ? ctx.folderEl(id) : ctx.cardById(id);
      if (!host) return null;
      return [...host.querySelectorAll("button")].find(
        b =>
          b.getAttribute("data-action") === (dir === "down" ? "move-down" : "move-up")
      ) || null;
    },
    sumTargets() {
      return app.AppState.getTimers().reduce(
        (s, t) => s + (Number(t.targetProportion) || 0),
        0
      );
    },
    cardText(timer, kind) {
      const el = ctx.elementOf(timer, kind);
      return el ? el.textContent : null;
    },
    elementOf(timer, kind) {
      const id = idOf(timer);
      const map = {
        planned: app.AppState.getTimerPlannedElement(id),
        tracked: app.AppState.getTimerTrackedElement(id),
        total: app.AppState.getTimerTotalElement(id),
        remaining: app.AppState.getTimerRemainingElement(id),
        recommendation: app.AppState.getTimerRecommendationElement(id),
        priority: app.AppState.getTimerPriorityElement(id),
        proportion: app.AppState.getTimerProportionElement(id),
        target: app.AppState.getTimerTargetProportionElement(id),
      };
      return map[kind];
    },
    /**
     * Видно ли элемент пользователю: учитывает и display/visibility самого
     * элемента, и всех предков (свёрнутая папка скрывает содержимое).
     */
    isVisible(el) {
      let node = el;
      while (node && node.nodeType === 1) {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return Boolean(el);
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
