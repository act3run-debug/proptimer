// Автотесты авто-режима «Отошёл».
//
// Что проверяем:
//  1. away-режим (механизм бывшей кнопки «Отошёл») включается САМ, пока не идёт
//     отсчёт ни одного таймера, и выключается на время отсчёта;
//  2. списание времени простоя из планов работает ровно так же, как работало с
//     кнопкой (пропорционально весам, с зажимом в ноль, без двойного счёта);
//  3. пользовательские действия и ролловер сессии по-прежнему пересчитывают
//     распределение (заморозка касается только фонового тика);
//  4. кнопки «Отошёл» в интерфейсе больше нет, остальной интерфейс цел;
//  5. перезагрузка страницы, авто-пауза и облачные ключи не сломаны.
//
// Запуск:  npm test     (node --test tests/)
// Тестируемый код извлекается прямо из index.html — см. tests/harness.js.
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, T0, DEFAULT_END, hhmm } = require("./harness.js");

// Все jsdom-окна закрываются по окончании прогона: процесс node --test
// завершается, даже если отдельный тест упал до собственного ctx.close().
after(closeAll);

const MIN = 60;
const HOUR = 3600;
const EPS = 1e-9;

/**
 * «Перезагрузка страницы»: переносим весь localStorage одного окружения
 * в другое — так же, как это делает браузер (включая lastSessionEndTime,
 * lastSaveAt, trackingOwnerDevice, cloudDeviceId).
 */
function reloadLike(from, to) {
  const ls = from.window.localStorage;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    to.window.localStorage.setItem(key, ls.getItem(key));
  }
  return to;
}

/**
 * Базовая сцена: две задачи с весами 0.6/0.4 и «Конец» через 2 часа от T0.
 * Планы пересчитаны от настенного времени, часы выровнены — тики
 * детерминированы.
 */
function scene(opts = {}) {
  const ctx = setup(opts);
  const a = ctx.addTimer({ name: "A", proportion: 0.6, targetProportion: 0.6 });
  const b = ctx.addTimer({ name: "B", proportion: 0.4, targetProportion: 0.4 });
  ctx.setEndTime(opts.end || DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, a, b, document: ctx.document, window: ctx.window };
}

/** Сцена, в которой away-режим уже взведён первым тиком. */
function idleScene(opts = {}) {
  const s = scene(opts);
  s.ctx.tick();
  assert.equal(s.ctx.isAway(), true, "away-режим должен взвестись первым тиком");
  s.startedAt = s.ctx.awayStart().getTime();
  s.plans = s.ctx.AppState.getTimers().map(t => t.plannedSeconds);
  s.weights = s.ctx.AppState.getTimers().map(t => t.proportion);
  s.total = s.plans.reduce((x, y) => x + y, 0);
  return s;
}

/** Сколько секунд суммарно списано с планов относительно снимка. */
const lost = (ctx, plans) => plans.reduce((s, p) => s + p, 0) - ctx.totalPlanned();

/**
 * Массивы, созданные внутри jsdom-окна, принадлежат другому realm, поэтому
 * deepEqual по ссылке на прототип не проходит — сравниваем как обычные числа.
 */
const nums = list => Array.from(list).map(Number);

// =====================================================================
//  1. Взвод и снятие away-режима
// =====================================================================

test("away-режим выключен до первого тика и взводится первым же тиком", () => {
  const { ctx } = scene();
  assert.equal(ctx.isAway(), false, "до тика приложение ещё не знает о простое");
  assert.equal(ctx.awayStart(), null);
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now, "точка отсчёта = текущее серверное время");
  ctx.close();
});

test("away-режим взводится, даже если задач нет вовсе", () => {
  const ctx = setup();
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now);
  ctx.close();
});

test("away-режим взводится сразу после загрузки сохранённого состояния", () => {
  const ctx = setup({ loadStorage: false });
  ctx.window.localStorage.setItem("timers", "[]");
  ctx.StorageService.loadTimersFromLocalStorage();
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  ctx.close();
});

test("TimeManager.isAnyTracking() отражает факт отсчёта", () => {
  const { ctx, a } = scene();
  assert.equal(ctx.TimeManager.isAnyTracking(), false);
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(ctx.TimeManager.isAnyTracking(), true);
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(ctx.TimeManager.isAnyTracking(), false);
  ctx.close();
});

test("syncAutoAway(): простой → away ON, отсчёт → away OFF", () => {
  const { ctx, a } = scene();
  ctx.TimeManager.syncAutoAway();
  assert.equal(ctx.isAway(), true);
  ctx.TimerController.toggleTracking(a.id);
  ctx.TimeManager.syncAutoAway();
  assert.equal(ctx.isAway(), false);
  assert.equal(ctx.awayStart(), null, "точка отсчёта простоя сброшена");
  ctx.close();
});

test("armAway() идемпотентен: повторный вызов не сбрасывает точку отсчёта", () => {
  const { ctx } = scene();
  assert.equal(ctx.TimeManager.armAway(), true, "первый взвод");
  const first = ctx.awayStart().getTime();
  ctx.clock.advanceSec(120);
  assert.equal(ctx.TimeManager.armAway(), false, "повторный взвод ничего не меняет");
  assert.equal(ctx.awayStart().getTime(), first, "точка отсчёта не сдвинулась — двойного списания нет");
  ctx.close();
});

test("deactivateAway() идемпотентен и возвращает признак изменения", () => {
  const { ctx } = scene();
  assert.equal(ctx.TimeManager.deactivateAway(), false, "нечего выключать");
  ctx.TimeManager.armAway();
  assert.equal(ctx.TimeManager.deactivateAway(), true);
  assert.equal(ctx.isAway(), false);
  assert.equal(ctx.awayStart(), null);
  assert.equal(ctx.TimeManager.deactivateAway(), false, "второй вызов — без изменений");
  ctx.close();
});

test("away-режим остаётся включённым на серии тиков (ничего не мигает)", () => {
  const { ctx } = scene();
  for (let i = 0; i < 20; i++) {
    ctx.clock.advance(200);
    ctx.tick();
    assert.equal(ctx.isAway(), true, `тик №${i + 1}`);
  }
  ctx.close();
});

test("переходы away-режима рассылают уведомления AppState", () => {
  const { ctx, a } = scene();
  const log = [];
  ctx.AppState.subscribe("awayModeChanged", v => log.push(["mode", v]));
  ctx.AppState.subscribe("awayStartTimeChanged", v => log.push(["start", v ? v.getTime() : null]));
  ctx.TimeManager.syncAutoAway();
  assert.deepEqual(log, [
    ["start", ctx.clock.now],
    ["mode", true],
  ]);
  log.length = 0;
  ctx.TimerController.toggleTracking(a.id);
  assert.deepEqual(log, [
    ["mode", false],
    ["start", null],
  ], "при старте отсчёта away-режим просто выключается, без промежуточного взвода");
  ctx.close();
});

// =====================================================================
//  2. Механика списания времени простоя
// =====================================================================

test("за 100 с простоя планы уменьшаются ровно на 100 с суммарно и по весам", () => {
  const { ctx, a, b, plans, weights, total } = idleScene();
  const sumW = weights.reduce((s, w) => s + w, 0);
  ctx.clock.advanceSec(100);
  ctx.tick();
  assert.ok(Math.abs(a.plannedSeconds - (plans[0] - 100 * (weights[0] / sumW))) < EPS);
  assert.ok(Math.abs(b.plannedSeconds - (plans[1] - 100 * (weights[1] / sumW))) < EPS);
  assert.ok(Math.abs(ctx.totalPlanned() - (total - 100)) < EPS);
  ctx.close();
});

test("списывание накапливается без двойного счёта: 10 тиков по 30 с = 300 с", () => {
  const { ctx, plans } = idleScene();
  for (let i = 0; i < 10; i++) {
    ctx.clock.advanceSec(30);
    ctx.tick();
  }
  assert.ok(Math.abs(lost(ctx, plans) - 300) < EPS, `списано ${lost(ctx, plans)} с, ожидалось 300`);
  ctx.close();
});

test("тик без хода времени ничего не списывает (точка отсчёта сдвигается)", () => {
  const { ctx } = idleScene();
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now);
  const plansNow = ctx.AppState.getTimers().map(t => t.plannedSeconds);
  ctx.tick();
  ctx.tick();
  ctx.tick();
  assert.deepEqual(ctx.AppState.getTimers().map(t => t.plannedSeconds), plansNow);
  ctx.close();
});

test("относительные доли планов сохраняются: простоем ничего не перераспределяется", () => {
  const { ctx } = idleScene();
  const [a0, b0] = ctx.AppState.getTimers();
  const ratioBefore = a0.plannedSeconds / b0.plannedSeconds;
  ctx.clock.advanceSec(500);
  ctx.tick();
  const [a1, b1] = ctx.AppState.getTimers();
  assert.ok(Math.abs(ratioBefore - a1.plannedSeconds / b1.plannedSeconds) < 1e-12);
  ctx.close();
});

test("«План», «Осталось» и «Факт» в DOM отражают простой", () => {
  const { ctx, a, b } = idleScene();
  ctx.tick();
  assert.equal(ctx.cardText(a, "planned"), ctx.Utils.formatTime(a.plannedSeconds));
  assert.equal(ctx.cardText(a, "remaining"), ctx.Utils.formatTime(a.plannedSeconds), "факт нулевой");
  assert.equal(ctx.cardText(a, "tracked"), "0ч 0м 0с");
  const remainingBefore = ctx.TimeCalculator.getTotalTime();
  const plansBefore = nums(ctx.AppState.getTimers().map(t => t.plannedSeconds));
  assert.ok(
    Math.abs(plansBefore.reduce((x, y) => x + y, 0) - remainingBefore) < 1e-6,
    "до простоя сумма планов равна остатку сессии"
  );
  assert.ok(Math.abs(plansBefore[0] - 0.6 * remainingBefore) < 1e-6, "план A = 0.6 от остатка");
  ctx.clock.advanceSec(600);
  ctx.tick();
  // Простой списывается из каждой задачи пропорционально её весу
  // (0.6 и 0.4), суммарно — ровно 600 с.
  assert.ok(Math.abs(a.plannedSeconds - (plansBefore[0] - 600 * 0.6)) < 1e-6, `план A ${a.plannedSeconds}`);
  assert.ok(Math.abs(b.plannedSeconds - (plansBefore[1] - 600 * 0.4)) < 1e-6, `план B ${b.plannedSeconds}`);
  assert.ok(Math.abs(lost(ctx, plansBefore) - 600) < 1e-6);
  assert.equal(a.remainingSeconds, a.plannedSeconds - a.trackedSeconds);
  assert.equal(ctx.cardText(a, "planned"), ctx.Utils.formatTime(a.plannedSeconds));
  assert.equal(ctx.cardText(a, "remaining"), ctx.Utils.formatTime(a.remainingSeconds));
  ctx.close();
});

test("простой до самого «Конца»: план тает до нуля, сессия не переключается", () => {
  const ctx = setup();
  const a = ctx.addTimer({ name: "A", proportion: 1, targetProportion: 1 });
  ctx.setEndTime("23:59");
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  ctx.tick(); // взвод away-режима
  const remaining = ctx.TimeCalculator.getTotalTime();
  assert.equal(a.plannedSeconds, remaining, "единственная задача забирает весь остаток сессии");
  // При весе 1 план тает со скоростью 1 с/с. Останавливаемся за 5 с до
  // «Конца»: простой длиннее сессии невозможен — раньше случится ролловер.
  ctx.clock.advanceSec(remaining - 5);
  ctx.tick();
  assert.ok(Math.abs(a.plannedSeconds - 5) < 1e-6, `план ${a.plannedSeconds}`);
  assert.ok(Math.abs(a.remainingSeconds - 5) < 1e-6);
  assert.equal(a.trackedSeconds, 0, "отсчёт не шёл — факт нулевой");
  assert.equal(ctx.cardText(a, "remaining"), ctx.Utils.formatTime(5));
  assert.ok(ctx.TimeCalculator.getTotalTime() > 0, "ролловера не было");
  ctx.close();
});

test("простой «съедает» доступное время: остаток уменьшается, хотя отсчёт не идёт", () => {
  // В этом и состоит назначение механизма «Отошёл»: пока пользователь не
  // работает, запланированное время расходуется, и «Осталось» тает даже без
  // намерянных секунд.
  const { ctx, a } = scene();
  const planAtStart = a.plannedSeconds;
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(600);
  ctx.tick();
  ctx.TimerController.toggleTracking(a.id); // пауза → авто-«Отошёл»
  assert.equal(ctx.isAway(), true);
  const planAtPause = a.plannedSeconds;
  // Пауза сама по себе планы не пересчитывает: остаётся значение,
  // зафиксированное на момент старта отсчёта.
  assert.equal(planAtPause, planAtStart, "во время отсчёта план заморожен");
  assert.ok(Math.abs(a.remainingSeconds - (planAtPause - 600)) < 1e-6);

  // Одна задача → вес 1 → простой списывается из плана секунда в секунду.
  ctx.TimerController.deleteTimer(ctx.AppState.getTimers()[1]);
  assert.equal(ctx.AppState.getTimers().length, 1);
  assert.equal(a.proportion, 1, "после удаления второй задачи вес ренормализован к 1");
  const planBefore = a.plannedSeconds;

  ctx.clock.advanceSec(1200);
  ctx.tick();
  assert.ok(Math.abs(a.plannedSeconds - (planBefore - 1200)) < 1e-6, `план ${a.plannedSeconds}`);
  assert.equal(a.trackedSeconds, 600, "факт не изменился — отсчёт не идёт");
  assert.ok(
    Math.abs(a.remainingSeconds - (planBefore - 1800)) < 1e-6,
    `остаток ${a.remainingSeconds}`
  );
  assert.equal(ctx.cardText(a, "remaining"), ctx.Utils.formatTime(a.remainingSeconds));
  ctx.close();
});

test("долгий простой при нулевом факте: остаток стремится к нулю, а не к минусу", () => {
  // При весах ≤ 1 сумма планов не превышает остатка сессии, поэтому одним
  // простоем «Осталось» ниже нуля не уходит (минус возможен только при
  // переработке — когда факт больше плана).
  const { ctx, a, b } = scene();
  ctx.tick();
  const start = nums(ctx.AppState.getTimers().map(t => t.plannedSeconds));
  const before = a.remainingSeconds;
  ctx.clock.advanceSec(1800);
  ctx.tick();
  assert.ok(a.remainingSeconds < before, "остаток уменьшился");
  assert.ok(a.remainingSeconds >= 0, `остаток ${a.remainingSeconds} не должен быть отрицательным`);
  assert.equal(a.trackedSeconds, 0);
  assert.equal(b.trackedSeconds, 0);
  const now = nums(ctx.AppState.getTimers().map(t => t.plannedSeconds));
  assert.ok(now[0] < start[0] && now[1] < start[1], "планы обеих задач уменьшились");
  ctx.close();
});

// =====================================================================
//  3. Отсчёт: away-режим выключен, планы заморожены
// =====================================================================

test("старт отсчёта выключает away-режим и замораживает планы", () => {
  const { ctx, a, b } = idleScene();
  const plans = ctx.AppState.getTimers().map(t => t.plannedSeconds);
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(ctx.isAway(), false);
  ctx.clock.advanceSec(600);
  ctx.tick();
  assert.deepEqual(ctx.AppState.getTimers().map(t => t.plannedSeconds), plans, "планы не тают");
  assert.ok(Math.abs(a.trackedSeconds - 600) < EPS);
  assert.equal(b.trackedSeconds, 0, "вторая задача не трекается");
  ctx.close();
});

test("переключение на другую задачу не включает away-режим ни на миг", () => {
  const { ctx, a, b } = scene();
  ctx.TimerController.toggleTracking(a.id);
  const seen = [];
  ctx.AppState.subscribe("awayModeChanged", v => seen.push(v));
  ctx.TimerController.toggleTracking(b.id);
  assert.equal(a.isTracking, false);
  assert.equal(b.isTracking, true);
  assert.equal(ctx.isAway(), false);
  assert.deepEqual(seen.filter(v => v === true), [], "away не взводится между стоп/старт");
  ctx.close();
});

test("после паузы простой снова списывается из планов", () => {
  const { ctx, a } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.recomputePlans();
  ctx.clock.advanceSec(300);
  ctx.TimerController.toggleTracking(a.id); // пауза
  const plans = ctx.AppState.getTimers().map(t => t.plannedSeconds);
  ctx.clock.advanceSec(200);
  ctx.tick();
  assert.ok(Math.abs(lost(ctx, plans) - 200) < EPS, `списано ${lost(ctx, plans)} с, ожидалось 200`);
  assert.ok(Math.abs(a.trackedSeconds - 300) < EPS, "факт сохранил намерянное");
  ctx.close();
});

test("цикл «старт → пауза» корректно повторяется несколько раз", () => {
  const { ctx, a } = scene();
  let expectedTracked = 0;
  for (let i = 0; i < 4; i++) {
    ctx.TimerController.toggleTracking(a.id); // старт
    assert.equal(ctx.isAway(), false, `цикл ${i}: во время отсчёта away выключен`);
    ctx.clock.advanceSec(60);
    ctx.tick();
    expectedTracked += 60;
    ctx.TimerController.toggleTracking(a.id); // пауза
    assert.equal(ctx.isAway(), true, `цикл ${i}: после паузы away включён`);
    ctx.clock.advanceSec(60);
    ctx.tick();
  }
  assert.ok(Math.abs(a.trackedSeconds - expectedTracked) < EPS, `${a.trackedSeconds} != ${expectedTracked}`);
  ctx.close();
});

test("во время отсчёта планы заморожены: время уходит в «Факт», а не из планов", () => {
  const { ctx, a, b } = scene();
  ctx.TimerController.toggleTracking(a.id);
  ctx.recomputePlans();
  const plans = nums(ctx.AppState.getTimers().map(t => t.plannedSeconds));
  const remainingAtStart = ctx.TimeCalculator.getTotalTime();
  ctx.clock.advanceSec(900);
  ctx.tick();
  assert.deepEqual(nums(ctx.AppState.getTimers().map(t => t.plannedSeconds)), plans, "планы не менялись");
  assert.ok(Math.abs(a.trackedSeconds - 900) < EPS, `факт ${a.trackedSeconds}`);
  assert.equal(b.trackedSeconds, 0);
  // Сessия тем временем идёт: остаток до «Конца» уменьшился, а планы — нет.
  assert.ok(Math.abs(ctx.TimeCalculator.getTotalTime() - (remainingAtStart - 900)) < EPS);
  assert.ok(Math.abs(ctx.totalPlanned() - (ctx.TimeCalculator.getTotalTime() + 900)) < EPS);
  ctx.close();
});

test("флаг autoAwayModeActive (переработка) считается только по активной задаче", () => {
  const { ctx, a } = scene();
  ctx.tick();
  assert.equal(ctx.AppState.isAutoAwayModeActive(), false, "в простое активной задачи нет");
  ctx.TimerController.toggleTracking(a.id);
  a.plannedSeconds = 10;
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.equal(ctx.AppState.isAutoAwayModeActive(), true, "факт превысил план");
  ctx.close();
});

// =====================================================================
//  4. Пользовательские действия при включённом away-режиме
// =====================================================================

test("autoUpdate() в простое пересчитывает распределение от настенного времени", () => {
  const { ctx, plans } = idleScene();
  ctx.clock.advanceSec(600);
  ctx.tick();
  // «Порчим» планы: если бы автообновление было заморожено, они бы не восстановились.
  ctx.AppState.getTimers().forEach(t => {
    t.plannedSeconds = 1;
  });
  ctx.AppController.autoUpdate();
  const remaining = ctx.TimeCalculator.getTotalTime();
  assert.ok(Math.abs(ctx.totalPlanned() - remaining) < 1e-6, `${ctx.totalPlanned()} != ${remaining}`);
  ctx.AppState.getTimers().forEach(t => {
    const expected = (t.proportion / ctx.AppState.getTimers().reduce((s, x) => s + x.proportion, 0)) * remaining;
    assert.ok(Math.abs(t.plannedSeconds - expected) < 1e-6, `план ${t.name} = ${t.plannedSeconds}`);
  });
  assert.equal(ctx.isAway(), true, "away-режим остаётся включённым (отсчёт не идёт)");
  assert.ok(lost(ctx, plans) > 0, "история списания простоя при этом не теряется из «Осталось»");
  ctx.close();
});

test("клик по кнопке карточки в простое пересчитывает распределение", () => {
  const { ctx, a } = idleScene();
  ctx.clock.advanceSec(900);
  ctx.tick();
  ctx.AppState.getTimers().forEach(t => {
    t.plannedSeconds = 1;
  });
  ctx.click(ctx.cardButton(a, "Обновить"));
  assert.ok(Math.abs(ctx.totalPlanned() - ctx.TimeCalculator.getTotalTime()) < 1e-6);
  assert.equal(ctx.isAway(), true);
  ctx.close();
});

test("смена «Конца» в простое сразу пересчитывает планы", () => {
  const { ctx, a, b } = idleScene();
  ctx.clock.advanceSec(600);
  ctx.tick();
  const newEnd = hhmm(HOUR * 1000); // «Конец» через час от T0
  ctx.setEndTime(newEnd);
  const remaining = ctx.TimeCalculator.getTotalTime();
  assert.ok(remaining > 0, "новый «Конец» в будущем");
  assert.ok(Math.abs(a.plannedSeconds - 0.6 * remaining) < 1e-6, `план A = ${a.plannedSeconds}`);
  assert.ok(Math.abs(b.plannedSeconds - 0.4 * remaining) < 1e-6, `план B = ${b.plannedSeconds}`);
  assert.equal(ctx.isAway(), true);
  ctx.close();
});

test("правка веса в простое пересчитывает планы и не портит поле ввода (БАГ #7)", () => {
  const { ctx, a, b } = idleScene();
  ctx.clock.advanceSec(300);
  ctx.tick();
  const input = ctx.elementOf(a, "proportion");
  input.value = "0.9";
  ctx.change(input);
  assert.equal(a.proportion, 0.9);
  assert.equal(b.proportion, 0.4);
  const remaining = ctx.TimeCalculator.getTotalTime();
  assert.ok(Math.abs(a.plannedSeconds - (0.9 / 1.3) * remaining) < 1e-6, `план A = ${a.plannedSeconds}`);
  assert.equal(input.value, "0.9", "поле ввода не перезаписано значением цели");
  ctx.close();
});

test("правка целевой пропорции в простое пересчитывает рекомендации", () => {
  const { ctx, a } = idleScene();
  ctx.clock.advanceSec(300);
  ctx.tick();
  const before = a.recommendedProportion;
  const input = ctx.elementOf(a, "target");
  input.value = "0.95";
  ctx.change(input);
  assert.equal(a.targetProportion, 0.95);
  assert.notEqual(a.recommendedProportion, before, "рекомендация отозвалась на новую цель");
  ctx.close();
});

test("глобальная кнопка «Сохранить» в простое пишет состояние и не ходит в сеть", () => {
  const { ctx, a } = idleScene();
  ctx.clock.advanceSec(300);
  ctx.tick();
  ctx.click(ctx.globalButton("Сохранить"));
  const saved = JSON.parse(ctx.window.localStorage.getItem("timers"));
  assert.equal(saved.length, 2);
  assert.equal(saved.find(t => t.id === a.id).name, "A");
  assert.equal(ctx.fetchCalls.length, 0, "облако не настроено — запросов быть не должно");
  ctx.close();
});

test("добавление задачи в простое пересчитывает планы и сохраняет away-режим", () => {
  const { ctx } = idleScene();
  ctx.clock.advanceSec(300);
  ctx.tick();
  const created = ctx.AppController.addNewTimer("C", "1/3");
  assert.ok(created, "задача создана");
  assert.equal(ctx.isAway(), true, "простой продолжается");
  assert.ok(ctx.card(created), "карточка новой задачи появилась в DOM");
  assert.ok(Math.abs(ctx.totalPlanned() - ctx.TimeCalculator.getTotalTime()) < 1e-6);
  // Существующая механика (не связана с «Отошёл»): у новой задачи
  // recommendedProportion = 0, а autoUpdate применяет рекомендации к весам,
  // поэтому её план нулевой, пока пользователь не задаст цель/вес вручную.
  assert.equal(created.recommendedProportion, 0);
  assert.equal(created.plannedSeconds, 0);
  ctx.close();
});

test("«Создать задачу внутри группы» в простое: away сохраняется, группа сжимается в (1 − p)", () => {
  const { ctx, a, b } = idleScene();
  // История группы — счётчики намерянного времени (totalSeconds), как после
  // реальной работы задач.
  a.totalSeconds = 600;
  a.dailyTotalSeconds = 600;
  a.originalDailyTotalSeconds = 600;
  b.totalSeconds = 400;
  b.dailyTotalSeconds = 400;
  b.originalDailyTotalSeconds = 400;
  ctx.clock.advanceSec(300);
  ctx.tick();
  assert.equal(ctx.isAway(), true);

  const created = ctx.AppController.createTaskInGroup([a.id, b.id], "C", "0.5");
  // Проверяем результат самой операции — до того, как следующий тик начнёт
  // списывать простой (createTaskInGroup вызывает autoUpdate, который
  // применяет рекомендации к весам; это существующая механика приложения).
  assert.ok(created, "задача создана");
  assert.ok(ctx.card(created), "карточка новой задачи в DOM");
  assert.equal(ctx.isAway(), true, "простой не прерывается групповой операцией");
  // Группа сжалась в (1 − p), относительные доли внутри группы сохранены.
  assert.ok(Math.abs(a.proportion - 0.3) < 1e-9, `вес A = ${a.proportion}`);
  assert.ok(Math.abs(b.proportion - 0.2) < 1e-9, `вес B = ${b.proportion}`);
  assert.ok(Math.abs(created.proportion - 0.5) < 1e-9, `вес C = ${created.proportion}`);
  assert.ok(Math.abs(created.targetProportion - 0.5) < 1e-9, `цель C = ${created.targetProportion}`);
  // «Виртуальная история» p·G/(1−p): G = 600 + 400 = 1000, p = 0.5 → 1000.
  assert.ok(Math.abs(created.totalSeconds - 1000) < 1e-6, `виртуальное время ${created.totalSeconds}`);
  assert.ok(Math.abs(created.dailyTotalSeconds - 1000) < 1e-6);
  assert.ok(Math.abs(created.lifetimeTotalSeconds - 1000) < 1e-6);
  // История существующих задач не пострадала.
  assert.ok(Math.abs(a.dailyTotalSeconds - 600) < 1e-6);
  assert.ok(Math.abs(b.dailyTotalSeconds - 400) < 1e-6);
  ctx.close();
});

test("«Разбить задачу» в простое делит историю пропорционально долям и сохраняет away", () => {
  const { ctx, a } = idleScene();
  a.trackedSeconds = 300;
  a.totalSeconds = 900;
  a.dailyTotalSeconds = 900;
  a.lifetimeTotalSeconds = 900;
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "A1", share: 1 / 3 },
    { name: "A2", share: 2 / 3 },
  ]);
  assert.equal(children.length, 2);
  assert.equal(ctx.isAway(), true, "простой не прерывается разбиением");
  assert.equal(ctx.AppState.getTimers().length, 3, "родитель заменён двумя подзадачами");
  assert.equal(ctx.card(a), null, "карточка родителя удалена");
  const [c1, c2] = children;
  assert.ok(Math.abs(c1.trackedSeconds - 100) < 1e-6, `факт A1 = ${c1.trackedSeconds}`);
  assert.ok(Math.abs(c2.trackedSeconds - 200) < 1e-6, `факт A2 = ${c2.trackedSeconds}`);
  assert.equal(c1.splitId, c2.splitId, "подзадачи связаны общим разбиением");
  ctx.close();
});

// =====================================================================
//  5. Ролловер сессии и суточный сброс
// =====================================================================

test("наступление «Конца» в простое пересчитывает планы (заморозка не блокирует ролловер)", () => {
  const ctx = setup();
  const a = ctx.addTimer({
    name: "A",
    proportion: 0.5,
    targetProportion: 0.5,
    trackedSeconds: 1000,
    dailyTotalSeconds: 1000,
    originalDailyTotalSeconds: 1000,
  });
  ctx.addTimer({ name: "B", proportion: 0.5, targetProportion: 0.5 });
  const end = hhmm(HOUR * 1000); // «Конец» через час
  ctx.setEndTime(end);
  ctx.recomputePlans();
  const stale = ctx.AppState.getTimers().map(t => t.plannedSeconds);
  const spy = [];
  const original = ctx.AppController.refreshDistribution;
  ctx.AppController.refreshDistribution = function () {
    spy.push(ctx.clock.now);
    return original.call(this);
  };
  ctx.tick(); // взвод away
  assert.equal(ctx.isAway(), true);
  ctx.clock.at(T0 + 90 * MIN * 1000); // на полчаса позже «Конца»
  ctx.tick();
  ctx.AppController.refreshDistribution = original;

  assert.ok(spy.length >= 1, "ролловер обязан пересчитать распределение даже в away-режиме");
  const nextEnd = ctx.AppState.getGlobalEndTime();
  assert.ok(nextEnd.getTime() > ctx.clock.now, "«Конец» сдвинут в будущее");
  assert.equal(a.dailyTotalSeconds, 0, "суточный сброс обнулил дневной итог");
  assert.equal(a.trackedSeconds, 0, "суточный сброс обнулил факт сессии");
  // Планы пересчитаны для новой сессии, и тут же из них списан простой:
  // вкладка «спала» 1,5 часа (с 14:00 до 15:30), и away-механизм учитывает
  // это время одним тиком — ровно так же, как учитывал при ручной кнопке.
  const slept = 90 * MIN;
  const rolled = ctx.TimeCalculator.getTotalTime() - slept;
  assert.ok(
    Math.abs(ctx.totalPlanned() - rolled) < 1e-6,
    `планы ${ctx.totalPlanned()} != остаток ${ctx.TimeCalculator.getTotalTime()} минус простой ${slept}`
  );
  assert.ok(ctx.totalPlanned() > stale[0] + stale[1], "планы не остались вчерашними");
  assert.equal(ctx.isAway(), true, "после ролловера простой продолжается");
  ctx.close();
});

test("после ролловера простой снова списывает время из новых планов", () => {
  const ctx = setup();
  ctx.addTimer({ name: "A", proportion: 0.5, targetProportion: 0.5 });
  ctx.addTimer({ name: "B", proportion: 0.5, targetProportion: 0.5 });
  ctx.setEndTime(hhmm(HOUR * 1000));
  ctx.recomputePlans();
  ctx.tick();
  ctx.clock.at(T0 + 90 * MIN * 1000);
  ctx.tick(); // ролловер
  const afterRollover = ctx.totalPlanned();
  ctx.clock.advanceSec(600);
  ctx.tick();
  assert.ok(Math.abs(afterRollover - ctx.totalPlanned() - 600) < 1e-6);
  ctx.close();
});

test("во время отсчёта ролловер сессии тоже пересчитывает планы и не срывает отсчёт", () => {
  const ctx = setup();
  const a = ctx.addTimer({ name: "A", proportion: 1, targetProportion: 1 });
  ctx.setEndTime(hhmm(HOUR * 1000));
  ctx.recomputePlans();
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(ctx.isAway(), false);
  ctx.clock.at(T0 + 90 * MIN * 1000);
  ctx.tick();
  assert.equal(ctx.isAway(), false, "отсчёт не должен прерываться ролловером");
  assert.equal(a.isTracking, true);
  assert.ok(Math.abs(ctx.totalPlanned() - ctx.TimeCalculator.getTotalTime()) < 1e-6);
  ctx.close();
});

test("суточный сброс не выключает away-режим и не ломает точку отсчёта", () => {
  const ctx = setup();
  ctx.addTimer({ name: "A", proportion: 1, targetProportion: 1, trackedSeconds: 500 });
  ctx.setEndTime(hhmm(HOUR * 1000));
  ctx.recomputePlans();
  ctx.tick();
  const armedAt = ctx.awayStart().getTime();
  ctx.clock.advanceSec(600);
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now);
  assert.notEqual(ctx.awayStart().getTime(), armedAt, "точка отсчёта сдвигается тиками");
  ctx.close();
});

// =====================================================================
//  6. Перезагрузка страницы / восстановление состояния
// =====================================================================

test("после перезагрузки away-режим взводится «сейчас», задним числом ничего не списывается", () => {
  // «Предыдущая сессия»: сохраняем состояние на момент T0 + 30 минут.
  const first = setup({ now: T0 + 30 * MIN * 1000 });
  first.addTimer({ name: "A", proportion: 0.6, targetProportion: 0.6 });
  first.addTimer({ name: "B", proportion: 0.4, targetProportion: 0.4 });
  first.setEndTime(DEFAULT_END);
  first.recomputePlans();
  first.AppState.setLastUpdateTime(new Date(first.clock.now));
  first.StorageService.saveToLocalStorage();
  const plans = nums(first.AppState.getTimers().map(t => t.plannedSeconds));
  const heartbeat = Number(first.window.localStorage.getItem("lastSaveAt"));
  assert.equal(first.window.localStorage.getItem("wasTimerActive"), "false");

  // «Перезагрузка» в тот же момент: состояние восстанавливается как есть.
  const ctx = setup({ now: heartbeat });
  reloadLike(first, ctx);
  first.close();
  ctx.StorageService.loadTimersFromLocalStorage();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  assert.equal(ctx.isAway(), false, "до тика away ещё не взведён");
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now, "точка отсчёта — момент загрузки");
  assert.deepEqual(
    nums(ctx.AppState.getTimers().map(t => t.plannedSeconds)),
    plans,
    "планы восстановлены; простоем задним числом ничего не списано"
  );
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.ok(Math.abs(lost(ctx, plans) - 60) < 1e-6, `списано ${lost(ctx, plans)} с, ожидалось 60`);
  assert.equal(ctx.AppState.getTimers()[0].name, "A");
  ctx.close();
});

test("короткое закрытие вкладки: отсчёт продолжается, away-режим выключен", () => {
  const first = setup();
  const t = first.addTimer({ name: "A", proportion: 1, targetProportion: 1 });
  first.setEndTime(DEFAULT_END);
  first.recomputePlans();
  first.TimerController.toggleTracking(t.id);
  first.clock.advanceSec(60);
  first.tick();
  first.StorageService.saveToLocalStorage();
  const heartbeat = Number(first.window.localStorage.getItem("lastSaveAt"));
  assert.equal(first.window.localStorage.getItem("wasTimerActive"), "true");

  const ctx = setup({ now: heartbeat + 10_000 }); // +10 с
  reloadLike(first, ctx);
  first.close();
  ctx.StorageService.loadTimersFromLocalStorage();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  const [restored] = ctx.AppState.getTimers();
  assert.equal(restored.isTracking, true, "отсчёт пережил короткую перезагрузку");
  ctx.tick();
  assert.equal(ctx.isAway(), false, "идёт отсчёт → away-режим выключен");
  assert.ok(restored.trackedSeconds >= 70 - EPS, `факт ${restored.trackedSeconds}, ожидалось ≥ 70`);
  ctx.close();
});

test("долгое закрытие вкладки: авто-пауза и сразу взведённый away-режим", () => {
  const first = setup();
  const t = first.addTimer({ name: "A", proportion: 1, targetProportion: 1 });
  first.setEndTime(DEFAULT_END);
  first.recomputePlans();
  first.TimerController.toggleTracking(t.id);
  first.clock.advanceSec(60);
  first.tick();
  first.StorageService.saveToLocalStorage();
  const heartbeat = Number(first.window.localStorage.getItem("lastSaveAt"));

  const ctx = setup({ now: heartbeat + 10 * MIN * 1000 }); // +10 минут
  reloadLike(first, ctx);
  first.close();
  ctx.StorageService.loadTimersFromLocalStorage();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  const [restored] = ctx.AppState.getTimers();
  assert.equal(restored.isTracking, false, "включилась авто-пауза");
  assert.ok(Math.abs(restored.trackedSeconds - 60) < EPS, "факт зафиксирован на момент сердцебиения");
  ctx.tick();
  assert.equal(ctx.isAway(), true, "после авто-паузы приложение в простое");
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now, "10 минут закрытой вкладки не списываются из планов");
  ctx.close();
});

test("away-состояние не синхронизируется и не persists в localStorage", () => {
  const { ctx } = idleScene();
  ctx.clock.advanceSec(300);
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  assert.ok(!ctx.CloudSync.STATE_KEYS.includes("awayModeActive"));
  assert.ok(!ctx.CloudSync.STATE_KEYS.includes("awayStartTime"));
  ctx.StorageService.saveToLocalStorage();
  const keys = Object.keys(ctx.window.localStorage);
  assert.ok(!keys.some(k => /away/i.test(k)), `в localStorage не должно быть away-ключей: ${keys}`);
  ctx.close();
});

test("серверное время (serverNow) используется для точки отсчёта простоя", () => {
  const { ctx } = scene();
  ctx.CloudSync.clockSkewMs = 5000; // устройство отстаёт на 5 с
  ctx.TimeManager.syncAutoAway();
  assert.equal(ctx.awayStart().getTime(), ctx.CloudSync.serverNow());
  assert.equal(ctx.awayStart().getTime(), ctx.clock.now + 5000);
  ctx.CloudSync.clockSkewMs = 0;
  ctx.close();
});

// =====================================================================
//  7. Интерфейс: кнопки «Отошёл» больше нет
// =====================================================================

test("в интерфейсе нет кнопки «Отошёл» и её обработчиков", () => {
  const { ctx, document } = scene();
  assert.equal(document.getElementById("awayButton"), null);
  assert.equal(document.querySelectorAll('[data-action="toggle-away"]').length, 0);
  assert.equal(ctx.AppController.toggleAway, undefined, "метод кнопки удалён");
  assert.equal(ctx.TimeManager.toggleAway, undefined, "ручной переключатель удалён");
  assert.equal(ctx.TimeManager.activateAwayMode, undefined, "старый взвод заменён на armAway");
  assert.equal(ctx.TimerView.updateAwayButton, undefined, "обновление кнопки удалено");
  assert.equal(ctx.AppState.getAwayButtonElement, undefined, "геттер кнопки удалён");
  ctx.close();
});

test("клик по бывшему data-action «toggle-away» ничего не ломает", () => {
  const { ctx, document } = scene();
  const ghost = document.createElement("button");
  ghost.setAttribute("data-action", "toggle-away");
  document.getElementById("globalControls").appendChild(ghost);
  ctx.click(ghost);
  // Никакого переключения: away-режим живёт по факту отсчёта.
  assert.equal(ctx.isAway(), false, "до тика away не взведён, клик его не включает");
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  ctx.click(ghost);
  assert.equal(ctx.isAway(), true, "клик по мёртвому действию не выключает away");
  ctx.close();
});

test("остальные кнопки панели на месте и работают", () => {
  const { ctx, document } = scene();
  const labels = [...document.querySelectorAll("#globalControls > button")].map(b => b.textContent.trim());
  for (const expected of [
    "+ Добавить таймер",
    "🕒 Носитель часового пояса",
    "Сохранить",
    "Экспорт",
    "Импорт",
    "☁ Облако",
    "☰ Операции",
  ]) {
    assert.ok(labels.includes(expected), `нет кнопки ${expected}: ${labels.join(", ")}`);
  }
  ctx.click(ctx.globalButton("☰ Операции"));
  assert.equal(document.getElementById("operationsMenu").classList.contains("visible"), true);
  ctx.click(ctx.globalButton("☁ Облако"));
  assert.equal(document.getElementById("modalOverlay").classList.contains("hidden"), false);
  ctx.close();
});

test("в CSS не осталось оформления убранной кнопки", () => {
  const { ctx, document } = scene();
  const css = [...document.querySelectorAll("style")].map(s => s.textContent).join("\n");
  assert.ok(!/active-away/.test(css), "класс удалённой кнопки должен быть убран из стилей");
  ctx.close();
});

test("в карточке задачи нет органов управления «Отошёл»", () => {
  const { ctx, a } = scene();
  const card = ctx.card(a);
  const actions = [...card.querySelectorAll("[data-action]")].map(el => el.getAttribute("data-action"));
  assert.ok(!actions.includes("toggle-away"), `действия карточки: ${actions.join(", ")}`);
  for (const expected of ["track", "reset", "delete", "update", "split"]) {
    assert.ok(actions.includes(expected), `нет действия ${expected}`);
  }
  ctx.close();
});
