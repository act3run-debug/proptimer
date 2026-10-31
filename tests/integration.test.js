// Интеграционные тесты и проверки целостности файла index.html.
//
//  1. «День из жизни» — сквозной сценарий: планирование → отсчёт → простой →
//     разбиение задачи → новая задача → суточный ролловер. На каждом шаге
//     проверяются инварианты (away-режим = простой, суммы планов, счётчики).
//  2. Целостность index.html: один скриптовый блок, валидный синтаксис,
//     единые окончания строк, на месте все классы приложения.
//
// Запуск:  npm test     (node --test tests/)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const {
  setup,
  closeAll,
  readHtml,
  INDEX_PATH,
  DEFAULT_END,
  hhmm,
} = require("./harness.js");

after(closeAll);

const MIN = 60;
const HOUR = 3600;
const EPS = 1e-9;
const nums = list => Array.from(list).map(Number);

// =====================================================================
//  Сквозной сценарий
// =====================================================================

test("день из жизни: планирование, отсчёт, простой, разбиение, ролловер", () => {
  const ctx = setup();

  // --- 1. Утро: две задачи и «Конец» дня ------------------------------
  const work = ctx.addTimer({ name: "Работа", proportion: 0.7, targetProportion: 0.7 });
  const sport = ctx.addTimer({ name: "Спорт", proportion: 0.3, targetProportion: 0.3 });
  ctx.setEndTime(hhmm(9 * HOUR * 1000));
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  const dayLength = ctx.TimeCalculator.getTotalTime();
  assert.ok(dayLength > 8 * HOUR, `остаток дня ${dayLength}`);
  assert.ok(Math.abs(ctx.totalPlanned() - dayLength) < 1e-6);
  assert.ok(Math.abs(work.plannedSeconds - 0.7 * dayLength) < 1e-6);

  // Отсчёт не идёт → приложение в простое (авто-«Отошёл»).
  ctx.tick();
  assert.equal(ctx.isAway(), true, "утром, до старта отсчёта, включён away-режим");

  // --- 2. Час работы ---------------------------------------------------
  ctx.click(ctx.cardButton(work, "Старт"));
  assert.equal(work.isTracking, true);
  assert.equal(ctx.isAway(), false, "во время отсчёта away-режим выключен");
  const planBeforeWork = nums(ctx.AppState.getTimers().map(t => t.plannedSeconds));
  for (let i = 0; i < 10; i++) {
    ctx.clock.advanceSec(6 * MIN);
    ctx.tick();
  }
  assert.ok(Math.abs(work.trackedSeconds - HOUR) < 1e-6, `намеряно ${work.trackedSeconds}`);
  assert.equal(sport.trackedSeconds, 0);
  assert.deepEqual(
    nums(ctx.AppState.getTimers().map(t => t.plannedSeconds)),
    planBeforeWork,
    "во время отсчёта планы заморожены"
  );

  // --- 3. Перерыв: простой списывается из планов ------------------------
  ctx.click(ctx.cardButton(work, "Пауза"));
  assert.equal(work.isTracking, false);
  assert.equal(ctx.isAway(), true, "пауза вернула приложение в простой");
  const planAtPause = nums(ctx.AppState.getTimers().map(t => t.plannedSeconds));
  ctx.clock.advanceSec(30 * MIN);
  ctx.tick();
  const lostTotal = planAtPause.reduce((s, p) => s + p, 0) - ctx.totalPlanned();
  assert.ok(Math.abs(lostTotal - 30 * MIN) < 1e-6, `простоем списано ${lostTotal} с`);
  assert.ok(Math.abs(work.trackedSeconds - HOUR) < EPS, "факт за перерыв не вырос");

  // --- 4. Разбиение задачи на подзадачи --------------------------------
  const children = ctx.AppController.splitTimer(work.id, [
    { name: "Код", share: 2 },
    { name: "Созвоны", share: 1 },
  ]);
  assert.equal(children.length, 2);
  assert.equal(ctx.AppState.getTimers().length, 3);
  assert.equal(ctx.isAway(), true, "операция не выводит из простоя");
  const [code, calls] = children;
  assert.ok(Math.abs(code.trackedSeconds - (2 / 3) * HOUR) < 1e-6, `факт «Код» ${code.trackedSeconds}`);
  assert.ok(Math.abs(calls.trackedSeconds - (1 / 3) * HOUR) < 1e-6, `факт «Созвоны» ${calls.trackedSeconds}`);
  assert.equal(code.splitId, calls.splitId);

  // --- 5. Снова работа: отсчёт подзадачи --------------------------------
  ctx.click(ctx.cardButton(code, "Старт"));
  assert.equal(code.isTracking, true);
  assert.equal(ctx.isAway(), false);
  ctx.clock.advanceSec(45 * MIN);
  ctx.tick();
  assert.ok(Math.abs(code.trackedSeconds - ((2 / 3) * HOUR + 45 * MIN)) < 1e-6);
  ctx.click(ctx.cardButton(code, "Пауза"));
  assert.equal(ctx.isAway(), true);

  // --- 6. Сохранение и контроль состояния -------------------------------
  ctx.StorageService.saveToLocalStorage();
  const saved = JSON.parse(ctx.window.localStorage.getItem("timers"));
  assert.equal(saved.length, 3);
  assert.equal(ctx.window.localStorage.getItem("wasTimerActive"), "false");

  // --- 7. Конец дня: ролловер сессии ------------------------------------
  const endAt = ctx.AppState.getGlobalEndTime().getTime() + 1000;
  const idleBeforeRollover = (endAt - ctx.awayStart().getTime()) / 1000;
  ctx.clock.at(endAt);
  ctx.tick();
  const timers = ctx.AppState.getTimers();
  timers.forEach(t => {
    assert.equal(t.dailyTotalSeconds, 0, `дневной итог обнулён у «${t.name}»`);
    assert.equal(t.trackedSeconds, 0, `факт сессии обнулён у «${t.name}»`);
  });
  assert.ok(ctx.AppState.getGlobalEndTime().getTime() > ctx.clock.now, "«Конец» сдвинут на завтра");
  assert.equal(ctx.isAway(), true, "после ролловера простой продолжается");
  // Планы пересчитаны для новой сессии, и тут же из них списан простой,
  // накопившийся с последнего тика (вкладка «спала» до самого «Конца»).
  const expected = ctx.TimeCalculator.getTotalTime() - idleBeforeRollover;
  assert.ok(
    Math.abs(ctx.totalPlanned() - expected) < 1e-6,
    `планы ${ctx.totalPlanned()} != остаток ${ctx.TimeCalculator.getTotalTime()} − простой ${idleBeforeRollover}`
  );
  assert.ok(idleBeforeRollover > 0, "к моменту ролловера был накоплен простой");
  ctx.close();
});

test("смена устройства-носителя времени не ломает простой", () => {
  const ctx = setup();
  const a = ctx.addTimer({ name: "A", proportion: 1, targetProportion: 1 });
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  const planBefore = a.plannedSeconds;

  // Другое устройство заявило себя носителем часового пояса.
  ctx.window.localStorage.setItem("tzHolderDevice", "other-device");
  ctx.window.localStorage.setItem("tzHolderZone", "Europe/Moscow");
  ctx.window.localStorage.setItem("tzHolderSkewMs", "3000");
  ctx.TimeZoneHolder.updateUI();

  ctx.clock.advanceSec(300);
  ctx.tick();
  assert.equal(ctx.isAway(), true, "простой продолжается");
  assert.ok(a.plannedSeconds < planBefore, "планы уменьшаются");
  assert.ok(Number.isFinite(a.plannedSeconds), "значения конечны");
  ctx.close();
});

// =====================================================================
//  Целостность index.html
// =====================================================================

test("index.html содержит ровно один скриптовый блок с кодом приложения", () => {
  const html = readHtml();
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(js.length > 100000, `скрипт подозрительно короткий: ${js.length}`);
  // Компиляция без выполнения — строгая проверка синтаксиса.
  assert.doesNotThrow(() => new vm.Script(js, { filename: "index.html:inline-script" }));
});

test("в коде на месте все классы приложения", () => {
  const js = readHtml().match(/<script>([\s\S]*?)<\/script>/)[1];
  const expected = [
    "NotificationService",
    "EventService",
    "SessionManager",
    "AppController",
    "StorageService",
    "TimerController",
    "TimerModel",
    "Timer",
    "ProportionCalculator",
    "TimeCalculator",
    "PriorityCalculator",
    "CalculationService",
    "TimerView",
    "TimeManager",
    "MenuController",
    "ModalController",
    "AddTaskController",
    "GroupTaskController",
    "SplitController",
    "UIFactory",
    "Utils",
    "CloudSync",
    "TimeZoneHolder",
    "CloudController",
  ];
  for (const name of expected) {
    assert.ok(js.includes(`class ${name}`), `нет класса ${name}`);
  }
});

test("в коде есть механизм авто-«Отошёл» и нет следов ручной кнопки", () => {
  const js = readHtml().match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const name of ["syncAutoAway", "armAway", "deactivateAway", "isAnyTracking"]) {
    assert.ok(js.includes(name), `нет TimeManager.${name}`);
  }
  assert.ok(!js.includes("toggle-away"), "обработчик кнопки «Отошёл» должен быть удалён");
  assert.ok(!js.includes("getAwayButtonElement"), "геттер кнопки должен быть удалён");
  assert.ok(!/awayButton/.test(js), "в коде не должно остаться обращений к кнопке");
  assert.ok(/isAwayModeActive/.test(js), "состояние away-режима сохранено");
});

test("index.html: единые окончания строк CRLF и корректная разметка", () => {
  const raw = fs.readFileSync(INDEX_PATH);
  const crlf = raw.toString("utf8").split("\r\n").length - 1;
  const total = raw.toString("utf8").split("\n").length - 1;
  assert.equal(crlf, total, "файл целиком в CRLF (как в истории репозитория)");
  const html = raw.toString("utf8");
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<meta charset="utf-8" \/>/);
  assert.match(html, /<title>Пропорциональный таймер<\/title>/);
  assert.match(html, /<div id="timersContainer"><\/div>/);
  assert.match(html, /<div id="modalOverlay" class="hidden">/);
});

test("в разметке нет кнопки «Отошёл», остальные кнопки панели на месте", () => {
  const html = readHtml();
  assert.ok(!/awayButton/.test(html), "в HTML не осталось id кнопки");
  assert.ok(!/data-action="toggle-away"/.test(html));
  for (const action of [
    "add-timer",
    "tz-holder",
    "save",
    "export",
    "import",
    "cloud",
    "menu",
    "create-in-group",
  ]) {
    assert.ok(html.includes(`data-action="${action}"`), `нет кнопки ${action}`);
  }
});

test("облачная конфигурация и версия приложения на месте", () => {
  const ctx = setup();
  assert.match(
    ctx.APP_VERSION,
    /^\d{4}-\d{2}-\d{2}-away-auto$/,
    "метка версии отражает перевод «Отошёл» в автоматический режим"
  );
  assert.match(ctx.CLOUD_CONFIG.url, /^https:\/\/.+\.supabase\.co$/);
  assert.ok(ctx.CLOUD_CONFIG.anonKey.startsWith("sb_publishable_"));
  assert.equal(ctx.CLOUD_CONFIG.syncIntervalMs, 20000);
  assert.equal(ctx.CloudSync.CHECKPOINT_MS, 60000);
  assert.equal(ctx.CloudSync.ABANDON_MS, 150000);
  ctx.close();
});
