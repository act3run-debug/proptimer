// Автотесты «Компактного режима по умолчанию».
//
// Нововведение: карточка задачи создаётся СВЁРНУТОЙ. В свёрнутом виде видны
// только Название, Целевая пропорция, Факт, Осталось, Приоритет и кнопка
// Старт/Пауза. Слева вверху карточки — стрелка: «▼» развернуть, «▲» свернуть.
//
// Тесты проверяют три слоя:
//   1. разметку и CSS (что именно показывается, а что скрыто — через
//      getComputedStyle: jsdom применяет <style> и считает каскад);
//   2. поведение стрелки (переключение, независимость карточек, отсутствие
//      побочных эффектов на модель/облако);
//   3. что свёрнутая карточка остаётся ПОЛНОСТЬЮ рабочей и что элементы из
//      DOM не удаляются (иначе сломались бы updateDisplay и облачный снимок).
//
// Набор завязан на компактный режим, поэтому на исходном коде он падает —
// это и есть доказательство, что тесты не тривиальны (см. tests/README.md).
//
// Запуск:  npm test     (node --test tests/)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, readHtml, DEFAULT_END } = require("./harness.js");

after(closeAll);

const ARROW_DOWN = "\u25BC"; // ▼ — карточка свёрнута
const ARROW_UP = "\u25B2"; // ▲ — карточка развёрнута

// Строки карточки, которые по ТЗ остаются видимыми в свёрнутом виде.
const COLLAPSED_VISIBLE = [
  "name-input-container", // Название
  "target-container", // Целевая пропорция
  "tracked-display-container", // Факт
  "remaining-display-container", // Осталось
  "priority-display-container", // Приоритет
  "buttons-container", // Старт/Пауза
  "compact-toggle-container", // сама стрелка
];

// Всё прочее в свёрнутом виде скрыто.
const COLLAPSED_HIDDEN = [
  "proportion-container", // Пропорция (вес)
  "planned-display-container", // План
  "total-display-container", // Всего
  "tracked-inputs-container", // «Факт вручную»
  "total-inputs-container", // «Всего вручную»
  "recommendation-display-container", // Рекомендация
  "actual-proportion-container", // Фактическая пропорция
];

const CARD_ACTIONS = [
  "name",
  "proportion",
  "target-proportion",
  "track",
  "reset",
  "delete",
  "update",
  "split",
];

function scene(opts = {}) {
  const ctx = setup(opts);
  const a = ctx.addTimer({ name: "A", proportion: 0.6, targetProportion: 0.6 });
  const b = ctx.addTimer({ name: "B", proportion: 0.4, targetProportion: 0.4 });
  ctx.setEndTime(opts.end || DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, a, b, document: ctx.document };
}

// --- хелперы -------------------------------------------------------------
const card = (ctx, t) => ctx.card(t);
const arrowOf = (ctx, t) => ctx.document.getElementById(`compact-toggle-${t.id}`);
const row = (ctx, t, cls) =>
  [...card(ctx, t).children].find(el => el.classList.contains(cls)) || null;
const visibleRows = (ctx, t) =>
  [...card(ctx, t).children].filter(el => isVisible(ctx, el));
/** Собственное вычисленное display элемента (без учёта предков). */
function display(ctx, el) {
  return el ? ctx.window.getComputedStyle(el).display : "MISSING";
}
function isVisible(ctx, el) {
  return Boolean(el) && display(ctx, el) !== "none";
}
/** Видимость с учётом скрытых предков (для кнопок и полей внутри строк). */
function shown(ctx, el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (ctx.window.getComputedStyle(n).display === "none") return false;
  }
  return Boolean(el);
}
const isCollapsed = (ctx, t) => card(ctx, t).classList.contains("collapsed");
const buttonByAction = (ctx, t, action) =>
  [...card(ctx, t).querySelectorAll("button")].find(
    b => b.getAttribute("data-action") === action
  ) || null;
const modelSnapshot = ctx =>
  ctx.AppState.getTimers().map(t => [
    t.id,
    t.name,
    t.proportion,
    t.targetProportion,
    t.plannedSeconds,
    t.trackedSeconds,
    t.recommendedProportion,
  ]);

// =====================================================================
//  1. Разметка и CSS
// =====================================================================

test("карточка новой задачи по умолчанию свёрнута", () => {
  const { ctx, a, b } = scene();
  assert.equal(isCollapsed(ctx, a), true, "A свёрнута");
  assert.equal(isCollapsed(ctx, b), true, "B свёрнута");
  assert.equal(card(ctx, a).className, "timer-container collapsed");
  assert.equal(ctx.TimerView.expandedTimers.size, 0, "список развёрнутых пуст");
  ctx.close();
});

test("стрелка — слева вверху карточки и корректно оформлена", () => {
  const { ctx, a } = scene();
  const c = card(ctx, a);
  assert.equal(
    c.firstElementChild.classList.contains("compact-toggle-container"),
    true,
    "контейнер стрелки — первый дочерний элемент карточки"
  );
  const arrow = arrowOf(ctx, a);
  assert.ok(arrow, "кнопка-стрелка существует");
  assert.equal(c.firstElementChild.firstElementChild, arrow);
  assert.equal(arrow.tagName, "BUTTON");
  assert.equal(arrow.getAttribute("data-action"), "toggle-compact");
  assert.equal(arrow.classList.contains("compact-toggle"), true);
  assert.equal(arrow.textContent, ARROW_DOWN, "свёрнута → стрелка вниз");
  assert.equal(arrow.getAttribute("aria-expanded"), "false");
  assert.equal(arrow.title, "Развернуть карточку");
  assert.ok(isVisible(ctx, c.firstElementChild), "стрелка видна");
  ctx.close();
});

test("в CSS описаны правила компактного режима", () => {
  const html = readHtml();
  for (const rule of [
    ".timer-container.collapsed > *:not(.compact-visible)",
    '.timer-container.collapsed .buttons-container button:not([data-action="track"])',
    ".compact-toggle-container",
    ".compact-toggle",
  ]) {
    assert.ok(html.includes(rule), `в стилях нет правила ${rule}`);
  }
  // Не вернули оформление удалённой кнопки «Отошёл» (см. auto-away.test.js).
  assert.ok(!/active-away/.test(html));
});

test("разрешённые строки помечены классом compact-visible", () => {
  const { ctx, a } = scene();
  for (const cls of COLLAPSED_VISIBLE) {
    const el = row(ctx, a, cls);
    assert.ok(el, `строка ${cls} существует`);
    assert.equal(el.classList.contains("compact-visible"), true, `${cls} в белом списке`);
  }
  for (const cls of COLLAPSED_HIDDEN) {
    const el = row(ctx, a, cls);
    assert.ok(el, `строка ${cls} существует`);
    assert.equal(
      el.classList.contains("compact-visible"),
      false,
      `${cls} НЕ должна быть в белом списке`
    );
  }
  ctx.close();
});

test("сворачивание ничего не удаляет из DOM", () => {
  const { ctx, a } = scene();
  const c = card(ctx, a);
  for (const cls of [...COLLAPSED_VISIBLE, ...COLLAPSED_HIDDEN]) {
    assert.ok(row(ctx, a, cls), `строка ${cls} на месте`);
  }
  for (const kind of ["planned", "tracked", "total", "remaining", "recommendation", "priority"]) {
    const el = ctx.document.getElementById(`${kind}-${a.id}`);
    assert.ok(el, `#${kind}-${a.id} существует`);
    assert.ok(c.contains(el), `#${kind}-${a.id} внутри карточки`);
  }
  const actions = [...c.querySelectorAll("[data-action]")].map(el => el.getAttribute("data-action"));
  for (const expected of [...CARD_ACTIONS, "toggle-compact"]) {
    assert.ok(actions.includes(expected), `нет data-action=${expected}`);
  }
  assert.equal(c.querySelectorAll(".actual-proportion").length, 1);
  ctx.close();
});

test("в свёрнутом виде видны ровно строки из ТЗ (и стрелка)", () => {
  const { ctx, a } = scene();
  for (const cls of COLLAPSED_VISIBLE) {
    assert.ok(isVisible(ctx, row(ctx, a, cls)), `${cls} должна быть видна`);
  }
  for (const cls of COLLAPSED_HIDDEN) {
    assert.equal(display(ctx, row(ctx, a, cls)), "none", `${cls} должна быть скрыта`);
  }
  assert.equal(
    visibleRows(ctx, a).length,
    COLLAPSED_VISIBLE.length,
    "видимых строк ровно столько, сколько разрешено"
  );
  ctx.close();
});

test("в свёрнутой карточке видна только кнопка Старт/Пауза", () => {
  const { ctx, a } = scene();
  assert.ok(shown(ctx, buttonByAction(ctx, a, "track")), "Старт видна");
  for (const action of ["reset", "delete", "update", "split"]) {
    const btn = buttonByAction(ctx, a, action);
    assert.ok(btn, `кнопка ${action} существует в DOM`);
    assert.equal(shown(ctx, btn), false, `кнопка ${action} скрыта`);
  }
  // Кнопки «Применить» ручного ввода скрыты вместе со своими строками.
  for (const action of ["apply-tracked", "apply-total"]) {
    const btn = card(ctx, a).querySelector(`[data-action="${action}"]`);
    assert.ok(btn, `${action} существует в DOM`);
    assert.equal(shown(ctx, btn), false, `${action} недоступна в свёрнутом виде`);
  }
  ctx.close();
});

test("поля свёрнутой карточки доступны для ввода", () => {
  const { ctx, a } = scene();
  assert.ok(shown(ctx, card(ctx, a).querySelector('[data-action="name"]')), "Название доступно");
  assert.ok(shown(ctx, ctx.elementOf(a, "target")), "Целевая пропорция доступна");
  assert.equal(
    shown(ctx, ctx.elementOf(a, "proportion")),
    false,
    "вес в свёрнутом виде скрыт"
  );
  ctx.close();
});

// =====================================================================
//  2. Поведение стрелки
// =====================================================================

test("клик по стрелке разворачивает карточку", () => {
  const { ctx, a } = scene();
  ctx.click(arrowOf(ctx, a));
  assert.equal(isCollapsed(ctx, a), false, "класс collapsed снят");
  assert.equal(card(ctx, a).className, "timer-container");
  const arrow = arrowOf(ctx, a);
  assert.equal(arrow.textContent, ARROW_UP, "стрелка вверх");
  assert.equal(arrow.getAttribute("aria-expanded"), "true");
  assert.equal(arrow.title, "Свернуть карточку");
  assert.equal(ctx.TimerView.isExpanded(a.id), true);
  ctx.close();
});

test("в развёрнутой карточке видно всё", () => {
  const { ctx, a } = scene();
  ctx.click(arrowOf(ctx, a));
  for (const cls of [...COLLAPSED_VISIBLE, ...COLLAPSED_HIDDEN]) {
    assert.ok(isVisible(ctx, row(ctx, a, cls)), `${cls} видна`);
  }
  for (const action of ["track", "reset", "delete", "update", "split"]) {
    assert.ok(shown(ctx, buttonByAction(ctx, a, action)), `кнопка ${action} видна`);
  }
  assert.equal(
    visibleRows(ctx, a).length,
    card(ctx, a).children.length,
    "скрытых строк не осталось"
  );
  ctx.close();
});

test("повторный клик по стрелке снова сворачивает карточку", () => {
  const { ctx, a } = scene();
  const arrow = arrowOf(ctx, a);
  ctx.click(arrow);
  ctx.click(arrow);
  assert.equal(isCollapsed(ctx, a), true);
  assert.equal(arrow.textContent, ARROW_DOWN);
  assert.equal(arrow.getAttribute("aria-expanded"), "false");
  assert.equal(arrow.title, "Развернуть карточку");
  for (const cls of COLLAPSED_HIDDEN) {
    assert.equal(display(ctx, row(ctx, a, cls)), "none", `${cls} снова скрыта`);
  }
  ctx.close();
});

test("клик маршрутизируется делегированием, а API toggleCompact доступен напрямую", () => {
  const { ctx, a } = scene();
  // Делегирование: событие всплывает до #timersContainer.
  ctx.click(arrowOf(ctx, a));
  assert.equal(isCollapsed(ctx, a), false);
  // Прямой вызов (используется, например, при программной перерисовке).
  assert.equal(ctx.TimerView.toggleCompact(a.id), false, "вернул новое состояние: свёрнута");
  assert.equal(isCollapsed(ctx, a), true);
  assert.equal(ctx.TimerView.toggleCompact(a.id), true, "вернул новое состояние: развёрнута");
  ctx.close();
});

test("карточки сворачиваются независимо друг от друга", () => {
  const { ctx, a, b } = scene();
  ctx.click(arrowOf(ctx, a));
  assert.equal(isCollapsed(ctx, a), false, "A развёрнута");
  assert.equal(isCollapsed(ctx, b), true, "B осталась свёрнутой");
  assert.equal(arrowOf(ctx, b).textContent, ARROW_DOWN);
  ctx.click(arrowOf(ctx, b));
  assert.equal(isCollapsed(ctx, a), false, "A не тронута");
  assert.equal(isCollapsed(ctx, b), false);
  ctx.click(arrowOf(ctx, a));
  assert.equal(isCollapsed(ctx, a), true);
  assert.equal(isCollapsed(ctx, b), false);
  ctx.close();
});

test("клик по стрелке не пересчитывает модель (autoUpdate не вызывается)", () => {
  const { ctx, a } = scene();
  ctx.AppController.calculateRecommendations();
  const before = modelSnapshot(ctx);
  let calls = 0;
  const original = ctx.AppController.autoUpdate;
  ctx.AppController.autoUpdate = function () {
    calls += 1;
    return original.apply(this, arguments);
  };
  try {
    ctx.click(arrowOf(ctx, a));
    ctx.click(arrowOf(ctx, a));
  } finally {
    ctx.AppController.autoUpdate = original;
  }
  assert.equal(calls, 0, "сворачивание — чисто визуальное действие");
  assert.deepEqual(modelSnapshot(ctx), before, "модель не изменилась");
  ctx.close();
});

test("клик по стрелке не трогает away-режим, модалку и меню", () => {
  const { ctx, a, document } = scene();
  ctx.tick(); // ничего не считается → авто-«Отошёл» взведён
  assert.equal(ctx.isAway(), true);
  const awayStart = ctx.awayStart();
  ctx.click(arrowOf(ctx, a));
  assert.equal(ctx.isAway(), true, "away-режим не переключился");
  assert.equal(ctx.awayStart(), awayStart, "точка отсчёта простоя не сброшена");
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), true);
  assert.equal(document.getElementById("operationsMenu").classList.contains("visible"), false);
  ctx.close();
});

test("состояние свёрнутости не сохраняется и не уходит в облако", () => {
  const { ctx, a } = scene();
  ctx.StorageService.saveToLocalStorage();
  const dumpBefore = ctx.window.localStorage.getItem("timers");
  const projBefore = ctx.CloudSync.meaningfulProjection(ctx.CloudSync.snapshotLocal());

  ctx.TimerView.toggleCompact(a.id);
  ctx.StorageService.saveToLocalStorage();

  assert.equal(
    ctx.window.localStorage.getItem("timers"),
    dumpBefore,
    "снимок таймеров байт-в-байт тот же"
  );
  assert.equal(
    ctx.CloudSync.meaningfulProjection(ctx.CloudSync.snapshotLocal()),
    projBefore,
    "«осмысленная проекция» облака не изменилась"
  );
  assert.ok(!dumpBefore.includes("collapsed"), "в модели нет следов компактного режима");
  assert.ok(!dumpBefore.includes("expanded"), "в модели нет следов компактного режима");
  ctx.close();
});

test("сворачивание не влияет на расчёты и рекомендации", () => {
  const { ctx, a, b } = scene();
  ctx.AppController.calculateRecommendations();
  const before = modelSnapshot(ctx);
  ctx.TimerView.toggleCompact(a.id);
  ctx.TimerView.toggleCompact(b.id);
  ctx.AppController.calculateRecommendations();
  assert.deepEqual(modelSnapshot(ctx), before);
  ctx.close();
});

// =====================================================================
//  3. Свёрнутая карточка полностью рабочая
// =====================================================================

test("Старт/Пауза работает прямо из свёрнутой карточки", () => {
  const { ctx, a } = scene();
  const start = buttonByAction(ctx, a, "track");
  assert.equal(start.textContent, "Старт");
  assert.ok(shown(ctx, start));
  ctx.click(start);
  assert.equal(a.isTracking, true, "отсчёт запущен");
  const pause = buttonByAction(ctx, a, "track");
  assert.equal(pause.textContent, "Пауза");
  assert.ok(shown(ctx, pause), "кнопка Пауза видна в свёрнутом виде");
  ctx.click(pause);
  assert.equal(a.isTracking, false);
  assert.equal(isCollapsed(ctx, a), true, "отсчёт не раскрыл карточку автоматически");
  ctx.close();
});

test("стрелка не мешает обновлению надписи Старт/Пауза", () => {
  const { ctx, a } = scene();
  // updateTimerTrackButton ищет кнопку по тексту среди ВСЕХ button карточки.
  a.isTracking = true;
  ctx.AppState.notify("timerStateChanged", a);
  assert.equal(buttonByAction(ctx, a, "track").textContent, "Пауза");
  assert.equal(arrowOf(ctx, a).textContent, ARROW_DOWN, "стрелка не перезаписана");
  a.isTracking = false;
  ctx.AppState.notify("timerStateChanged", a);
  assert.equal(buttonByAction(ctx, a, "track").textContent, "Старт");
  assert.equal(arrowOf(ctx, a).textContent, ARROW_DOWN);
  ctx.close();
});

test("«Факт» и «Осталось» обновляются в свёрнутой карточке", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(300);
  ctx.tick();
  assert.equal(isCollapsed(ctx, a), true);
  assert.match(ctx.cardText(a, "tracked"), /5м 0с/, "Факт растёт");
  const remaining = ctx.cardText(a, "remaining");
  assert.match(remaining, /^-?\d+ч \d+м \d+с$/, `Осталось: ${remaining}`);
  ctx.close();
});

test("«Приоритет» виден и заполняется после расчёта рекомендаций", () => {
  const { ctx, a, b } = scene();
  assert.ok(isVisible(ctx, row(ctx, a, "priority-display-container")));
  assert.equal(ctx.cardText(a, "priority"), "Приоритет: ");
  ctx.AppController.calculateRecommendations();
  assert.match(ctx.cardText(a, "priority"), /^Приоритет: \d+$/);
  assert.match(ctx.cardText(b, "priority"), /^Приоритет: \d+$/);
  ctx.close();
});

test("название и целевую пропорцию можно править, не разворачивая карточку", () => {
  const { ctx, a } = scene();
  const nameInput = card(ctx, a).querySelector('[data-action="name"]');
  nameInput.value = "Новое имя";
  ctx.change(nameInput);
  assert.equal(a.name, "Новое имя", "имя доехало до модели");

  const targetInput = ctx.elementOf(a, "target");
  assert.equal(targetInput.value, "0.6");
  targetInput.value = "0.9";
  ctx.change(targetInput);
  assert.ok(
    Math.abs(a.targetProportion - 0.9) < 1e-9,
    `целевая пропорция в модели: ${a.targetProportion}`
  );
  assert.equal(isCollapsed(ctx, a), true, "карточка осталась свёрнутой");
  ctx.close();
});

test("скрытые поля продолжают обновляться и свежи после разворачивания", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(300);
  ctx.tick();
  ctx.AppController.calculateRecommendations();

  assert.equal(display(ctx, row(ctx, a, "planned-display-container")), "none");
  const plannedHidden = ctx.cardText(a, "planned");
  const totalHidden = ctx.cardText(a, "total");
  const recHidden = ctx.cardText(a, "recommendation");
  assert.ok(plannedHidden && plannedHidden.length > 0, "План посчитан, хотя и скрыт");
  assert.ok(recHidden.startsWith("Рекомендация:"), "Рекомендация посчитана, хотя и скрыта");

  ctx.TimerView.toggleCompact(a.id);
  assert.ok(isVisible(ctx, row(ctx, a, "planned-display-container")), "План показан");
  assert.equal(ctx.cardText(a, "planned"), plannedHidden, "значение не «протухло»");
  assert.equal(ctx.cardText(a, "total"), totalHidden);
  assert.equal(ctx.cardText(a, "recommendation"), recHidden);
  ctx.close();
});

// =====================================================================
//  4. Жизненный цикл состояния
// =====================================================================

test("карточки, восстановленные из localStorage, тоже свёрнуты", () => {
  const { ctx, a } = scene();
  ctx.StorageService.saveToLocalStorage();
  const dumped = ctx.window.localStorage.getItem("timers");
  const endValue = ctx.window.localStorage.getItem("globalEndTimeValue");
  const boundary = ctx.window.localStorage.getItem("lastSessionEndTime");

  const fresh = setup();
  fresh.window.localStorage.setItem("timers", dumped);
  fresh.window.localStorage.setItem("globalEndTimeValue", endValue);
  fresh.window.localStorage.setItem("lastSessionEndTime", boundary);
  fresh.StorageService.loadTimersFromLocalStorage();

  const [restored] = fresh.AppState.getTimers();
  assert.equal(restored.name, a.name);
  assert.ok(fresh.card(restored), "карточка отрисована");
  assert.equal(fresh.card(restored).classList.contains("collapsed"), true);
  assert.equal(
    fresh.document.getElementById(`compact-toggle-${restored.id}`).textContent,
    ARROW_DOWN
  );
  fresh.close();
  ctx.close();
});

test("подзадачи разбиения создаются свёрнутыми, их «Доля» скрыта до раскрытия", () => {
  const { ctx, a } = scene();
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "A1", share: 1 },
    { name: "A2", share: 2 },
  ]);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(isCollapsed(ctx, child), true, `${child.name} свёрнута`);
    const share = row(ctx, child, "split-share-container");
    assert.ok(share, "строка доли создана");
    assert.equal(display(ctx, share), "none", "в свёрнутом виде доля скрыта");
  }
  ctx.TimerView.toggleCompact(children[0].id);
  assert.ok(isVisible(ctx, row(ctx, children[0], "split-share-container")), "доля показана");
  assert.equal(isCollapsed(ctx, children[1]), true, "вторая подзадача не затронута");
  ctx.close();
});

test("развёрнутое состояние переживает перерисовку карточки", () => {
  const { ctx, a } = scene();
  ctx.TimerView.toggleCompact(a.id);
  assert.equal(isCollapsed(ctx, a), false);
  // Имитация перерисовки (импорт/облачный приём создают карточки заново).
  card(ctx, a).remove();
  ctx.TimerView.addTimerElement(a);
  assert.equal(isCollapsed(ctx, a), false, "карточка пересоздана развёрнутой");
  assert.equal(arrowOf(ctx, a).textContent, ARROW_UP, "стрелка вверх");
  ctx.close();
});

test("удаление задачи убирает её из списка развёрнутых", () => {
  const { ctx, a, b } = scene();
  ctx.TimerView.toggleCompact(a.id);
  assert.equal(ctx.TimerView.expandedTimers.size, 1);
  ctx.TimerController.deleteTimer(a);
  assert.equal(ctx.TimerView.expandedTimers.has(String(a.id)), false);
  assert.equal(ctx.TimerView.expandedTimers.size, 0, "состояние не накапливается");
  assert.ok(card(ctx, b), "вторая карточка на месте");
  assert.equal(isCollapsed(ctx, b), true);
  ctx.close();
});

test("пересчёты (тик, «Конец», рекомендации) не сбрасывают состояние стрелок", () => {
  const { ctx, a, b } = scene();
  ctx.TimerView.toggleCompact(a.id);
  ctx.clock.advanceSec(60);
  ctx.tick();
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppController.calculateRecommendations();
  ctx.tick();
  assert.equal(isCollapsed(ctx, a), false, "развёрнутая осталась развёрнутой");
  assert.equal(isCollapsed(ctx, b), true, "свёрнутая осталась свёрнутой");
  assert.equal(arrowOf(ctx, a).textContent, ARROW_UP);
  assert.equal(arrowOf(ctx, b).textContent, ARROW_DOWN);
  ctx.close();
});

test("API компактного режима и метка версии на месте", () => {
  const { ctx } = scene();
  assert.match(
    ctx.APP_VERSION,
    /^\d{4}-\d{2}-\d{2}-compact$/,
    "метка версии отражает компактный режим"
  );
  assert.equal(ctx.TimerView.COMPACT_DOWN, ARROW_DOWN);
  assert.equal(ctx.TimerView.COMPACT_UP, ARROW_UP);
  for (const method of [
    "isExpanded",
    "createCompactToggle",
    "applyCompactState",
    "toggleCompact",
    "forgetCompactState",
  ]) {
    assert.equal(typeof ctx.TimerView[method], "function", `нет TimerView.${method}`);
  }
  assert.ok(ctx.TimerView.expandedTimers instanceof ctx.window.Set);
  // Механизм авто-«Отошёл» из прошлой задачи не пострадал.
  for (const method of ["syncAutoAway", "armAway", "deactivateAway", "isAnyTracking"]) {
    assert.equal(typeof ctx.TimeManager[method], "function", `нет TimeManager.${method}`);
  }
  ctx.close();
});

test("в коде нет следов ручного переключателя «Отошёл» (регрессионная защита)", () => {
  const html = readHtml();
  assert.ok(!/awayButton/.test(html));
  assert.ok(!html.includes("toggle-away"));
  assert.ok(html.includes('=== "toggle-compact"'), "диспетчер различает действие стрелки");
  assert.ok(
    html.includes("TimerView.toggleCompact("),
    "диспетчер вызывает TimerView.toggleCompact"
  );
});
