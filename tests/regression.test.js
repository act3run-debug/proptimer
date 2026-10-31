// Регрессионные автотесты: проверяют, что остальная логика приложения
// (отсчёт, ручная коррекция, операции над задачами, рекомендации, суточный
// сброс, хранилище, модальные окна, отрисовка карточек, утилиты) работает
// так же, как работала до перевода «Отошёл» в автоматический режим.
//
// Набор намеренно НЕ завязан на авто-«Отошёл», поэтому его можно прогнать и
// против исходной версии страницы — так доказывается отсутствие регрессий:
//
//     git show 504ffe7:index.html > /tmp/baseline/index.html
//     INDEX_HTML=/tmp/baseline/index.html node --test tests/regression.test.js
//
// Запуск:  npm test     (node --test tests/)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, readHtml, T0, DEFAULT_END, hhmm } = require("./harness.js");

after(closeAll);

const MIN = 60;
const HOUR = 3600;
const EPS = 1e-9;
const nums = list => Array.from(list).map(Number);

function scene(opts = {}) {
  const ctx = setup(opts);
  const a = ctx.addTimer({ name: "A", proportion: 0.6, targetProportion: 0.6 });
  const b = ctx.addTimer({ name: "B", proportion: 0.4, targetProportion: 0.4 });
  ctx.setEndTime(opts.end || DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, a, b, document: ctx.document };
}

// =====================================================================
//  Отсчёт времени
// =====================================================================

test("старт/пауза: «Факт» растёт только у активной задачи", () => {
  const { ctx, a, b } = scene();
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(a.isTracking, true);
  assert.equal(b.isTracking, false);
  ctx.clock.advanceSec(120);
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 120) < EPS);
  assert.equal(b.trackedSeconds, 0);
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(a.isTracking, false);
  ctx.clock.advanceSec(120);
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 120) < EPS, "после паузы факт не растёт");
  ctx.close();
});

test("одновременно может идти только один отсчёт", () => {
  const { ctx, a, b } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.TimerController.toggleTracking(b.id);
  const tracking = ctx.AppState.getTimers().filter(t => t.isTracking);
  assert.equal(tracking.length, 1);
  assert.equal(tracking[0].id, b.id);
  ctx.close();
});

test("«Факт» выводится из startTime и снимка — начисление идемпотентно", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(300);
  ctx.tick();
  ctx.tick();
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 300) < EPS, `факт ${a.trackedSeconds}`);
  // Все накопительные счётчики растут синхронно с фактом.
  for (const field of [
    "totalTrackedSeconds",
    "totalDuration",
    "dailyTrackedSeconds",
    "totalSeconds",
    "lifetimeTotalSeconds",
  ]) {
    assert.ok(Math.abs(a[field] - 300) < EPS, `${field} = ${a[field]}`);
  }
  ctx.close();
});

test("уведомление о завершении задачи отправляется один раз на пересечении плана", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  a.plannedSeconds = 100;
  ctx.notifications.length = 0;
  ctx.clock.advanceSec(50);
  ctx.tick();
  assert.equal(ctx.notifications.length, 0, "план ещё не превышен");
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.equal(ctx.notifications.length, 1, "на пересечении плана — одно уведомление");
  assert.equal(ctx.notifications[0].title, "Prep Task Completed");
  assert.match(ctx.notifications[0].body, /A/);
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.equal(ctx.notifications.length, 1, "повторно не дублируется");
  ctx.close();
});

test("«Всего» показывает накопленный итог, «Осталось» = план − факт", () => {
  const { ctx, a } = scene();
  a.lifetimeTotalSeconds = 3600;
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(600);
  ctx.tick();
  assert.equal(ctx.cardText(a, "total"), ctx.Utils.formatTime(a.lifetimeTotalSeconds));
  assert.ok(a.lifetimeTotalSeconds >= 3600 + 600 - EPS);
  assert.equal(a.remainingSeconds, a.plannedSeconds - a.trackedSeconds);
  assert.equal(ctx.cardText(a, "remaining"), ctx.Utils.formatTime(a.remainingSeconds));
  ctx.close();
});

// =====================================================================
//  Сброс и ручная коррекция счётчиков
// =====================================================================

test("«Сброс» отменяет намерянное за сессию время", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(300);
  ctx.tick();
  ctx.TimerController.toggleTracking(a.id);
  const dailyBefore = a.dailyTotalSeconds;
  ctx.TimerController.resetTimer(a);
  assert.equal(a.trackedSeconds, 0);
  assert.ok(a.dailyTotalSeconds < dailyBefore, "дневной итог уменьшен на отменённое время");
  assert.ok(a.dailyTotalSeconds >= 0, "счётчики не уходят в минус");
  assert.equal(a.isTracking, false);
  ctx.close();
});

test("ручной ввод «Факт» распределяет дельту по всем счётчикам", () => {
  const { ctx, a } = scene();
  const card = ctx.card(a);
  card.querySelector('[data-type="tracked-hours"]').value = "1";
  card.querySelector('[data-type="tracked-minutes"]').value = "30";
  card.querySelector('[data-type="tracked-seconds"]').value = "0";
  ctx.TimerController.handleTrackedApplyButtonClick(a.id);
  assert.equal(a.trackedSeconds, 5400);
  assert.equal(a.dailyTrackedSeconds, 5400);
  assert.equal(a.totalTrackedSeconds, 5400);
  assert.equal(a.lifetimeTotalSeconds, 5400);
  assert.ok(a.dailyTotalSeconds >= 5400, "дневной итог подтянут за фактом");
  ctx.close();
});

test("ручной ввод «Всего» задаёт базу и обнуляет намерянное", () => {
  const { ctx, a } = scene();
  a.trackedSeconds = 500;
  a.totalTrackedSeconds = 500;
  const card = ctx.card(a);
  card.querySelector('[data-type="total-hours"]').value = "2";
  card.querySelector('[data-type="total-minutes"]').value = "0";
  card.querySelector('[data-type="total-seconds"]').value = "0";
  ctx.TimerController.handleTotalApplyButtonClick(a.id);
  assert.equal(a.totalSeconds, 7200);
  assert.equal(a.dailyTotalSeconds, 7200);
  assert.equal(a.lifetimeTotalSeconds, 7200);
  assert.equal(a.originalDailyTotalSeconds, 7200);
  assert.equal(a.totalTrackedSeconds, 0);
  ctx.close();
});

test("правка «Факт» во время отсчёта сдвигает снимок, а не ломает вывод", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(100);
  ctx.tick();
  const card = ctx.card(a);
  card.querySelector('[data-type="tracked-hours"]').value = "1";
  card.querySelector('[data-type="tracked-minutes"]').value = "0";
  card.querySelector('[data-type="tracked-seconds"]').value = "0";
  ctx.TimerController.handleTrackedApplyButtonClick(a.id);
  assert.equal(a.trackedSeconds, 3600);
  ctx.clock.advanceSec(50);
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 3650) < EPS, `факт ${a.trackedSeconds}`);
  ctx.close();
});

// =====================================================================
//  Операции над задачами
// =====================================================================

test("«Удалить» убирает карточку и ренормализует веса и цели к единице", () => {
  const { ctx, a, b, document } = scene();
  ctx.TimerController.deleteTimer(a);
  assert.equal(ctx.AppState.getTimers().length, 1);
  assert.equal(document.getElementById(`timer-${a.id}`), null, "карточка удалена из DOM");
  assert.ok(Math.abs(b.proportion - 1) < EPS, `вес ${b.proportion}`);
  assert.ok(Math.abs(b.targetProportion - 1) < EPS, `цель ${b.targetProportion}`);
  ctx.close();
});

test("«Разбить» делит историю пропорционально долям и связывает подзадачи", () => {
  const { ctx, a, document } = scene();
  a.trackedSeconds = 900;
  a.dailyTotalSeconds = 900;
  a.lifetimeTotalSeconds = 900;
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "A1", share: 1 },
    { name: "A2", share: 2 },
  ]);
  assert.equal(children.length, 2);
  assert.equal(ctx.AppState.getTimers().length, 3, "родитель заменён двумя подзадачами");
  assert.equal(document.getElementById(`timer-${a.id}`), null);
  const [c1, c2] = children;
  assert.ok(Math.abs(c1.trackedSeconds - 300) < EPS, `факт A1 = ${c1.trackedSeconds}`);
  assert.ok(Math.abs(c2.trackedSeconds - 600) < EPS, `факт A2 = ${c2.trackedSeconds}`);
  assert.ok(Math.abs(c1.splitShare - 1 / 3) < EPS);
  assert.ok(Math.abs(c2.splitShare - 2 / 3) < EPS);
  assert.equal(c1.splitId, c2.splitId);
  assert.equal(c1.splitParentName, "A");
  assert.equal(c1.isTracking, false, "трекинг у подзадач сброшен");
  ctx.close();
});

test("доли разбиения нормализуются к сумме 1", () => {
  const { ctx, a } = scene();
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "X", share: 5 },
    { name: "Y", share: 15 },
  ]);
  const sum = children.reduce((s, c) => s + c.splitShare, 0);
  assert.ok(Math.abs(sum - 1) < EPS, `сумма долей ${sum}`);
  ctx.close();
});

test("«Создать задачу внутри группы» добавляет задачу и пересчитывает планы", () => {
  const { ctx, a, b } = scene();
  a.totalSeconds = 600;
  b.totalSeconds = 400;
  const created = ctx.AppController.createTaskInGroup([a.id, b.id], "C", "0.5");
  assert.equal(ctx.AppState.getTimers().length, 3);
  assert.equal(created.name, "C");
  assert.ok(ctx.card(created), "карточка новой задачи создана");
  // Операция завершается autoUpdate, поэтому планы соответствуют текущему
  // остатку сессии (веса к этому моменту уже приведены к рекомендациям —
  // существующая механика приложения).
  assert.ok(
    Math.abs(ctx.totalPlanned() - ctx.TimeCalculator.getTotalTime()) < 1e-6,
    `${ctx.totalPlanned()} != ${ctx.TimeCalculator.getTotalTime()}`
  );
  ctx.close();
});

test("сжатие группы в (1 − p) и «виртуальная история» видны до автообновления", () => {
  const { ctx, a, b } = scene();
  a.totalSeconds = 600;
  b.totalSeconds = 400;
  // autoUpdate внутри операции применяет рекомендации к весам — перехватываем
  // его, чтобы увидеть результат собственно групповой механики.
  const original = ctx.AppController.autoUpdate;
  ctx.AppController.autoUpdate = () => {};
  const created = ctx.AppController.createTaskInGroup([a.id, b.id], "C", "0.5");
  ctx.AppController.autoUpdate = original;
  assert.ok(Math.abs(a.proportion - 0.3) < EPS, `вес A = ${a.proportion}`);
  assert.ok(Math.abs(b.proportion - 0.2) < EPS, `вес B = ${b.proportion}`);
  assert.ok(Math.abs(created.proportion - 0.5) < EPS, `вес C = ${created.proportion}`);
  assert.ok(Math.abs(created.targetProportion - 0.5) < EPS);
  // Виртуальная история p·G/(1−p): G = 600 + 400 = 1000, p = 0.5 → 1000.
  assert.ok(Math.abs(created.totalSeconds - 1000) < EPS, `виртуальное время ${created.totalSeconds}`);
  ctx.close();
});

test("доля «внутри группы» принимает обычные дроби (1/4)", () => {
  const { ctx, a, b } = scene();
  const seen = [];
  const original = ctx.AppController.createTaskInGroup;
  ctx.AppController.createTaskInGroup = function (groupIds, name, share) {
    seen.push({ groupIds: nums(groupIds), name, share });
    return original.call(this, groupIds, name, share);
  };
  ctx.GroupTaskController.openModal();
  ctx.document.querySelectorAll(".group-checkbox").forEach(cb => {
    cb.checked = true;
  });
  ctx.document.getElementById("groupTaskName").value = "Дробная";
  ctx.document.getElementById("groupTaskProportion").value = "1/4";
  ctx.ModalController.handleOverlayClick({
    target: ctx.document.getElementById("groupTaskConfirm"),
  });
  ctx.AppController.createTaskInGroup = original;
  assert.equal(seen.length, 1, "модалка вызвала групповую операцию один раз");
  assert.equal(seen[0].name, "Дробная");
  assert.ok(Math.abs(seen[0].share - 0.25) < EPS, `доля ${seen[0].share}`);
  assert.equal(seen[0].groupIds.length, 2, "в группу вошли обе отмеченные задачи");
  ctx.close();
});

test("«Добавить таймер» при пустом списке создаёт обычную задачу", () => {
  const ctx = setup();
  const t = ctx.AppController.addNewTimer("Первая", null);
  assert.ok(t);
  assert.equal(t.name, "Первая");
  assert.equal(ctx.AppState.getTimers().length, 1);
  assert.ok(ctx.card(t), "карточка создана");
  ctx.close();
});

// =====================================================================
//  Рекомендации и приоритеты
// =====================================================================

test("рекомендации нормированы и обнуляют перевыполненные задачи", () => {
  const { ctx, a, b } = scene();
  a.plannedSeconds = 100;
  a.trackedSeconds = 500; // факт больше плана → перевыполнение
  b.trackedSeconds = 0;
  ctx.AppController.calculateRecommendations();
  assert.equal(a.recommendedProportion, 0, "перевыполненная задача не получает времени");
  assert.ok(b.recommendedProportion > 0);
  ctx.close();
});

test("приоритет — порядок по разнице рекомендации и фактической доли", () => {
  const { ctx, a, b } = scene();
  a.trackedSeconds = 0;
  b.trackedSeconds = 0;
  a.dailyTotalSeconds = 0;
  a.originalDailyTotalSeconds = 0;
  b.dailyTotalSeconds = 5000;
  b.originalDailyTotalSeconds = 5000;
  ctx.AppController.calculateRecommendations();
  const priorities = ctx.CalculationService.calculatePriority(ctx.AppState.getTimers());
  const text = t => ctx.cardText(t, "priority");
  assert.match(text(a), /^Приоритет: \d+$/);
  assert.match(text(b), /^Приоритет: \d+$/);
  assert.notEqual(text(a), text(b), "приоритеты различаются");
  // Отстающая задача (A) должна быть выше приоритетом, чем B с большой историей.
  const num = t => Number(text(t).replace(/\D/g, ""));
  assert.ok(num(a) < num(b), `A=${num(a)} B=${num(b)}`);
  assert.equal(priorities.length, 2, "калькулятор вернул список приоритетов");
  ctx.close();
});

test("«Применить рекомендацию» делает рекомендации текущими весами", () => {
  const { ctx, a, b } = scene();
  ctx.AppController.calculateRecommendations();
  const recA = a.recommendedProportion;
  ctx.AppController.applyRecommendations();
  assert.ok(Math.abs(a.proportion - recA) < EPS, `вес ${a.proportion} != рекомендация ${recA}`);
  const input = ctx.elementOf(a, "proportion");
  assert.equal(input.value, String(recA), "поле веса синхронизировано с моделью");
  ctx.close();
});

test("фактическая пропорция считается по дневным итогам и равна 100% в сумме", () => {
  const { ctx, a, b } = scene();
  a.dailyTotalSeconds = 3000;
  a.originalDailyTotalSeconds = 3000;
  b.dailyTotalSeconds = 1000;
  b.originalDailyTotalSeconds = 1000;
  const pa = ctx.ProportionCalculator.getActualProportion(a.id);
  const pb = ctx.ProportionCalculator.getActualProportion(b.id);
  assert.ok(Math.abs(pa - 75) < EPS, `A = ${pa}%`);
  assert.ok(Math.abs(pb - 25) < EPS, `B = ${pb}%`);
  ctx.AppController.calculateRecommendations();
  assert.match(ctx.cardText(a, "priority"), /^Приоритет: \d+$/);
  ctx.close();
});

// =====================================================================
//  Суточный сброс (ролловер сессии)
// =====================================================================

test("суточный сброс обнуляет счётчики сессии и сохраняет долю прошлой сессии", () => {
  const { ctx, a } = scene();
  a.trackedSeconds = 700;
  a.dailyTrackedSeconds = 700;
  a.dailyTotalSeconds = 700;
  ctx.AppState.setLastSessionEndTime(new Date(ctx.clock.now - 1000));
  ctx.SessionManager.checkAndPerformReset();
  assert.equal(a.trackedSeconds, 0);
  assert.equal(a.dailyTrackedSeconds, 0);
  assert.equal(a.dailyTotalSeconds, 0);
  assert.equal(a.originalDailyTotalSeconds, 700, "база прошлого дня сохранена");
  assert.ok(a.lastSessionDisplayProportion !== undefined, "доля прошлой сессии запомнена");
  assert.equal(ctx.SessionManager.isJustAfterReset, true);
  ctx.close();
});

test("суточный сброс выполняется ровно один раз (граница сдвигается в будущее)", () => {
  const { ctx, a } = scene();
  a.trackedSeconds = 100;
  ctx.AppState.setLastSessionEndTime(new Date(ctx.clock.now - 1000));
  ctx.SessionManager.checkAndPerformReset();
  const boundary = ctx.AppState.getLastSessionEndTime();
  assert.ok(boundary.getTime() > ctx.clock.now, "граница сдвинута в будущее");
  a.trackedSeconds = 50;
  ctx.SessionManager.checkAndPerformReset();
  ctx.SessionManager.checkAndPerformReset();
  assert.equal(a.trackedSeconds, 50, "повторного обнуления нет");
  ctx.close();
});

test("идущий отсчёт переживает суточный сброс (rebase от нуля)", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(120);
  ctx.tick();
  ctx.AppState.setLastSessionEndTime(new Date(ctx.clock.now - 1000));
  ctx.SessionManager.checkAndPerformReset();
  assert.equal(a.isTracking, true, "отсчёт не прерван");
  assert.equal(a.trackedSeconds, 0, "новая сессия начинается с нуля");
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 60) < EPS, `факт ${a.trackedSeconds}`);
  ctx.close();
});

// =====================================================================
//  Хранилище и устойчивость к битым данным
// =====================================================================

test("сохранение пишет все ключи состояния", () => {
  const { ctx } = scene();
  ctx.StorageService.saveToLocalStorage();
  const ls = ctx.window.localStorage;
  assert.ok(ls.getItem("timers"));
  assert.equal(ls.getItem("globalEndTimeValue"), DEFAULT_END);
  assert.equal(ls.getItem("wasTimerActive"), "false");
  assert.ok(Number.isFinite(Number(ls.getItem("lastSessionEndTime"))));
  assert.ok(Number.isFinite(Number(ls.getItem("lastSaveAt"))));
  ctx.close();
});

test("состояние переживает сохранение/загрузку", () => {
  const { ctx, a } = scene();
  a.trackedSeconds = 1234;
  a.dailyTotalSeconds = 1234;
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
  assert.equal(restored.name, "A");
  assert.equal(restored.trackedSeconds, 1234);
  assert.ok(restored.dailyTotalSeconds >= 1234);
  assert.ok(fresh.card(restored), "карточка восстановленной задачи отрисована");
  fresh.close();
  ctx.close();
});

test("битый JSON в хранилище не «убивает» приложение (БАГ #8)", () => {
  const ctx = setup();
  ctx.window.localStorage.setItem("timers", "{это не json");
  ctx.StorageService.loadTimersFromLocalStorage();
  assert.deepEqual(nums(ctx.AppState.getTimers()), []);
  const t = ctx.addTimer({ name: "Живая", proportion: 1, targetProportion: 1 });
  ctx.tick();
  assert.ok(ctx.card(t), "приложение рабочее: карточки создаются, тик идёт");
  ctx.close();
});

test("мусорные записи отбрасываются, поля приводятся к числам (БАГ #9)", () => {
  const ctx = setup();
  const good = ctx.TimerModel.createTimer();
  good.name = "Нормальная";
  good.trackedSeconds = "600"; // строка вместо числа
  const junk = [null, 42, "строка", [], { noId: true }];
  ctx.window.localStorage.setItem("timers", JSON.stringify([...junk, good]));
  ctx.StorageService.loadTimersFromLocalStorage();
  const timers = ctx.AppState.getTimers();
  assert.equal(timers.length, 1, "мусор отброшен");
  assert.equal(timers[0].name, "Нормальная");
  assert.equal(timers[0].trackedSeconds, 600, "строка приведена к числу");
  ctx.close();
});

test("«null» вместо границы сессии не превращается в Invalid Date (БАГ #10)", () => {
  const ctx = setup();
  ctx.window.localStorage.setItem("timers", "[]");
  ctx.window.localStorage.setItem("lastSessionEndTime", "null");
  ctx.StorageService.loadTimersFromLocalStorage();
  const boundary = ctx.AppState.getLastSessionEndTime();
  assert.ok(boundary === null || !isNaN(boundary.getTime()), `граница = ${String(boundary)}`);
  ctx.tick(); // не должно бросать
  ctx.close();
});

test("недоступный localStorage не роняет сохранение (БАГ #11)", () => {
  const { ctx } = scene();
  const original = ctx.window.localStorage.setItem;
  ctx.window.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.doesNotThrow(() => ctx.StorageService.saveToLocalStorage());
  ctx.window.localStorage.setItem = original;
  ctx.tick();
  ctx.close();
});

// =====================================================================
//  Утилиты
// =====================================================================

test("Utils.formatTime: положительные и отрицательные значения", () => {
  const ctx = setup();
  const f = s => ctx.Utils.formatTime(s);
  assert.equal(f(0), "0ч 0м 0с");
  assert.equal(f(59), "0ч 0м 59с");
  assert.equal(f(3600), "1ч 0м 0с");
  assert.equal(f(4320), "1ч 12м 0с");
  assert.equal(f(-300), "-0ч 5м 0с", "переработка форматируется по модулю со знаком");
  assert.equal(f(-3661), "-1ч 1м 1с");
  ctx.close();
});

test("Utils.parseShareInput: десятичные, запятая и обычные дроби", () => {
  const ctx = setup();
  const p = v => ctx.Utils.parseShareInput(v);
  assert.equal(p("0.25"), 0.25);
  assert.equal(p("0,25"), 0.25);
  assert.equal(p("1/4"), 0.25);
  assert.equal(p("2/3"), 2 / 3);
  assert.ok(Number.isNaN(p("")), "пусто — это «не ввели», а не ноль");
  assert.ok(Number.isNaN(p("abc")));
  assert.ok(Number.isNaN(p("1/0")));
  assert.ok(Number.isNaN(p("1/2/3")));
  ctx.close();
});

test("Utils.parseTimeInput терпит запятую как разделитель", () => {
  const ctx = setup();
  assert.equal(ctx.Utils.parseTimeInput("0,75"), 0.75);
  assert.equal(ctx.Utils.parseTimeInput("1.5"), 1.5);
  assert.equal(ctx.Utils.parseTimeInput("мусор"), 0);
  ctx.close();
});

test("TimeCalculator.parseGlobalEndTime строго валидирует ЧЧ:ММ (БАГ #4)", () => {
  const ctx = setup();
  const p = v => ctx.TimeCalculator.parseGlobalEndTime(v);
  assert.deepEqual(nums(p("23:59")), [23, 59]);
  assert.deepEqual(nums(p("7:05")), [7, 5]);
  assert.equal(p(""), null);
  assert.equal(p("abc"), null);
  assert.equal(p("24:00"), null);
  assert.equal(p("12:60"), null);
  ctx.close();
});

test("Utils.generateId: числовой id и уникальность при разных метках времени", () => {
  const ctx = setup();
  const id = ctx.Utils.generateId();
  assert.equal(typeof id, "number");
  assert.ok(Number.isFinite(id));
  // Id — это Date.now() + Math.random(): при остановленных часах коллизии
  // возможны (известное ограничение), поэтому уникальность проверяем на серии
  // с разными метками времени.
  const ids = new Set();
  for (let i = 0; i < 200; i++) {
    ctx.clock.advance(1);
    ids.add(ctx.Utils.generateId());
  }
  assert.equal(ids.size, 200);
  ctx.close();
});

// =====================================================================
//  Отрисовка карточек и DOM
// =====================================================================

test("карточка задачи содержит все поля и кнопки", () => {
  const { ctx, a } = scene();
  const card = ctx.card(a);
  assert.ok(card, "карточка создана");
  assert.equal(card.className, "timer-container");
  assert.equal(card.id, `timer-${a.id}`);
  const actions = [...card.querySelectorAll("[data-action]")].map(el => el.getAttribute("data-action"));
  for (const expected of ["name", "proportion", "target-proportion", "track", "reset", "delete", "update", "split"]) {
    assert.ok(actions.includes(expected), `нет элемента с data-action=${expected}`);
  }
  for (const expected of [
    "planned",
    "tracked",
    "total",
    "remaining",
    "recommendation",
    "priority",
  ]) {
    const el = ctx.document.getElementById(`${expected}-${a.id}`);
    assert.ok(el, `нет элемента #${expected}-${a.id}`);
    assert.ok(card.contains(el), `#${expected}-${a.id} вне карточки`);
  }
  assert.equal(card.querySelectorAll(".actual-proportion").length, 1);
  assert.equal(card.querySelectorAll('[data-type="tracked-hours"]').length, 1);
  assert.equal(card.querySelectorAll('[data-type="total-seconds"]').length, 1);
  ctx.close();
});

test("кнопка отсчёта переключает надпись «Старт»/«Пауза»", () => {
  const { ctx, a } = scene();
  assert.equal(ctx.cardButton(a, "Старт").getAttribute("data-action"), "track");
  ctx.TimerController.toggleTracking(a.id);
  assert.ok(ctx.cardButton(a, "Пауза"), "надпись сменилась на «Пауза»");
  ctx.TimerController.toggleTracking(a.id);
  assert.ok(ctx.cardButton(a, "Старт"), "надпись вернулась к «Старт»");
  ctx.close();
});

test("изменения модели доезжают до DOM через подписки", () => {
  const { ctx, a } = scene();
  a.plannedSeconds = 1234;
  ctx.AppState.notify("displayNeedsUpdate");
  assert.equal(ctx.cardText(a, "planned"), ctx.Utils.formatTime(1234));
  a.trackedSeconds = 600;
  ctx.AppState.notify("timerUpdated", a);
  assert.equal(ctx.cardText(a, "tracked"), ctx.Utils.formatTime(600));
  ctx.close();
});

test("клик по кнопке карточки маршрутизируется делегированием и вызывает действие", () => {
  const { ctx, a } = scene();
  ctx.click(ctx.cardButton(a, "Старт"));
  assert.equal(a.isTracking, true, "делегированный обработчик запустил отсчёт");
  ctx.click(ctx.cardButton(a, "Пауза"));
  assert.equal(a.isTracking, false);
  ctx.close();
});

test("смена названия в поле ввода попадает в модель", () => {
  const { ctx, a } = scene();
  const input = ctx.elementOf(a, "name") || ctx.card(a).querySelector('[data-action="name"]');
  input.value = "Новое имя";
  ctx.change(input);
  assert.equal(a.name, "Новое имя");
  ctx.close();
});

// =====================================================================
//  Модальные окна и меню
// =====================================================================

test("«+ Добавить таймер» открывает модалку, доля 1/4 принимается", () => {
  const { ctx, document } = scene();
  ctx.click(ctx.globalButton("+ Добавить таймер"));
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), false);
  document.getElementById("addTaskName").value = "Новая";
  document.getElementById("addTaskProportion").value = "1/4";
  ctx.ModalController.handleOverlayClick({
    target: document.getElementById("addTaskConfirm"),
  });
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), true, "модалка закрыта");
  const names = ctx.AppState.getTimers().map(t => t.name);
  assert.ok(names.includes("Новая"), `список задач: ${names.join(", ")}`);
  ctx.close();
});

test("некорректная доля в модалке добавления показывает ошибку и не создаёт задачу", () => {
  const { ctx, document } = scene();
  const before = ctx.AppState.getTimers().length;
  ctx.click(ctx.globalButton("+ Добавить таймер"));
  document.getElementById("addTaskName").value = "Ошибка";
  document.getElementById("addTaskProportion").value = "1.5";
  ctx.ModalController.handleOverlayClick({
    target: document.getElementById("addTaskConfirm"),
  });
  assert.equal(ctx.AppState.getTimers().length, before, "задача не создана");
  assert.match(document.getElementById("modalError").textContent, /[Дд]ол/);
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), false, "модалка осталась открытой");
  ctx.close();
});

test("модалка разбиения требует минимум две подзадачи с названиями", () => {
  const { ctx, a, document } = scene();
  ctx.SplitController.openModal(a.id);
  assert.equal(document.querySelectorAll("#splitRows .split-row").length, 2);
  ctx.ModalController.handleOverlayClick({ target: document.getElementById("splitAddRow") });
  assert.equal(document.querySelectorAll("#splitRows .split-row").length, 3, "строка добавлена");
  // Пустые имена → ошибка, разбиения нет.
  ctx.ModalController.handleOverlayClick({ target: document.getElementById("splitConfirm") });
  assert.match(document.getElementById("modalError").textContent, /назван/i);
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("модалка «Создать задачу внутри группы» требует отметить группу", () => {
  const { ctx, document } = scene();
  ctx.GroupTaskController.openModal();
  assert.equal(document.querySelectorAll(".group-checkbox").length, 2, "в списке все задачи");
  ctx.ModalController.handleOverlayClick({ target: document.getElementById("groupTaskConfirm") });
  assert.match(document.getElementById("modalError").textContent, /[Оо]тметьте/);
  assert.equal(ctx.AppState.getTimers().length, 2, "ничего не создано");
  ctx.close();
});

test("меню «Операции» открывается и закрывается", () => {
  const { ctx, document } = scene();
  const menu = document.getElementById("operationsMenu");
  assert.equal(menu.classList.contains("visible"), false);
  ctx.click(ctx.globalButton("☰ Операции"));
  assert.equal(menu.classList.contains("visible"), true);
  ctx.MenuController.hide();
  assert.equal(menu.classList.contains("visible"), false);
  ctx.close();
});

test("клик по подложке закрывает модальное окно", () => {
  const { ctx, document } = scene();
  ctx.click(ctx.globalButton("+ Добавить таймер"));
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), false);
  ctx.click(document.getElementById("modalOverlay"));
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), true);
  ctx.close();
});

test("окно «Облако» показывает версию приложения и статус ключа", () => {
  const { ctx, document } = scene();
  ctx.CloudController.openModal();
  const text = document.getElementById("modalBox").textContent;
  assert.match(text, /Облачная синхронизация/);
  assert.ok(text.includes(ctx.APP_VERSION), "версия видна в окне облака");
  assert.match(text, /Ключ синхронизации/);
  ctx.close();
});

test("облако не настроено → синхронизация не мешает локальной работе", () => {
  const { ctx } = scene();
  assert.equal(ctx.CloudSync.isActive(), false, "нет ключа синхронизации");
  assert.equal(ctx.CloudSync.isConfigured(), true, "URL и publishable key заданы");
  ctx.tick();
  ctx.StorageService.saveToLocalStorage();
  assert.equal(ctx.fetchCalls.length, 0, "сетевых запросов нет");
  ctx.close();
});

// =====================================================================
//  Фоновые циклы и целостность страницы
// =====================================================================

test("приложение регистрирует тик 200 мс и автосохранение 60 с", () => {
  const ctx = setup(); // setup уже вызывает init()
  assert.deepEqual(nums(ctx.intervals.map(i => i.ms)).sort((x, y) => x - y), [200, 60000]);
  ctx.close();
});

test("window.onload запускает приложение и облачную загрузку", async () => {
  const ctx = setup();
  assert.equal(typeof ctx.window.onload, "function");
  await ctx.window.onload();
  assert.equal(ctx.AppState.getTimers().length, 0);
  assert.equal(ctx.fetchCalls.length, 0, "без ключа синхронизации сеть не дёргается");
  const t = ctx.addTimer({ name: "После старта", proportion: 1, targetProportion: 1 });
  ctx.tick();
  assert.ok(ctx.card(t), "после onload приложение полностью рабочее");
  assert.ok(Number.isFinite(t.plannedSeconds));
  ctx.close();
});

test("в index.html ровно один скриптовый блок и он syntactически валиден", () => {
  const html = readHtml();
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(js.length > 100000, `длина скрипта ${js.length}`);
  assert.match(js, /class TimeManager/, "код приложения на месте");
});

test("версия приложения задана и видна из кода", () => {
  const ctx = setup();
  assert.match(ctx.APP_VERSION, /^\d{4}-\d{2}-\d{2}-/, "формат метки версии — дата и суффикс");
  ctx.close();
});
