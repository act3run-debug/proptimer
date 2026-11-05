// «Заморозить для редактирования»: пока режим включён, Доли и Целевые
// пропорции можно вводить по одной — остальные значения не пересчитываются,
// а поля показывают введённое. При выключении: суммы равны 1 — значения
// применяются разом, иначе красная ошибка и откат к значениям до заморозки.
// Заодно: «Сохранить», «Экспорт», «Импорт» живут в меню «Операции».
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, DEFAULT_END } = require("./harness.js");

after(closeAll);

const near = (a, b, msg, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const byId = (ctx, id) => ctx.document.getElementById(id);

function world(specs) {
  const ctx = setup();
  const by = {};
  specs.forEach(([name, t]) => {
    by[name] = ctx.addTimer({ name, proportion: t, targetProportion: t });
  });
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, by };
}
const btn = ctx => byId(ctx, "freezeButton");
const toggle = ctx => ctx.click(btn(ctx));
const isOn = ctx => btn(ctx).classList.contains("active");
const targetInput = (ctx, t) => ctx.elementOf(t, "target");
function type(ctx, input, value) {
  input.value = String(value);
  ctx.change(input);
}
const toast = ctx => byId(ctx, "appToast");
const toastShown = ctx => toast(ctx).classList.contains("show");
const weightSum = ctx =>
  ctx.AppState.getTimers().reduce((s, t) => s + (Number(t.proportion) || 0), 0);

// =====================================================================
//  Кнопка
// =====================================================================

test("кнопка «Заморозить для редактирования» есть в верхней панели и выключена", () => {
  const { ctx } = world([["A", 1]]);
  const b = btn(ctx);
  assert.ok(b, "кнопка есть");
  assert.equal(b.textContent.trim(), "Заморозить для редактирования");
  assert.equal(b.parentElement.id, "globalControls");
  assert.equal(b.getAttribute("aria-pressed"), "false");
  assert.equal(isOn(ctx), false);
  ctx.close();
});

test("нажатие включает режим (подсветка, aria-pressed), повторное — выключает", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  assert.equal(isOn(ctx), true);
  assert.equal(btn(ctx).getAttribute("aria-pressed"), "true");
  assert.equal(ctx.document.body.classList.contains("freeze-mode"), true);
  assert.equal(ctx.FreezeMode.active, true);
  toggle(ctx);
  assert.equal(isOn(ctx), false);
  assert.equal(btn(ctx).getAttribute("aria-pressed"), "false");
  assert.equal(ctx.document.body.classList.contains("freeze-mode"), false);
  assert.equal(ctx.FreezeMode.active, false);
  ctx.close();
});

test("включённая кнопка пульсирует голубым (CSS-анимация), для reduced-motion — без анимации", () => {
  const { ctx } = world([["A", 1]]);
  const css = [...ctx.document.querySelectorAll("style")].map(s => s.textContent).join("\n");
  assert.match(css, /#freezeButton\.active\s*\{[^}]*animation:\s*freeze-pulse/);
  assert.match(css, /@keyframes freeze-pulse/);
  assert.match(css, /rgba\(106,\s*167,\s*255/, "голубой цвет");
  assert.match(
    css,
    /prefers-reduced-motion[^{]*\{[^]*#freezeButton\.active\s*\{[^}]*animation:\s*none/,
    "без анимации при reduced-motion"
  );
  ctx.close();
});

test("без включения кнопки поведение прежнее: правка цели сразу пересчитывает остальные", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  type(ctx, targetInput(ctx, by.A), 0.2);
  near(by.A.targetProportion, 0.2, "A");
  near(by.B.targetProportion + by.C.targetProportion, 0.8, "остальные подстроились");
  assert.ok(by.B.targetProportion > 0.3, "B выросла сама");
  ctx.close();
});

// =====================================================================
//  Целевые пропорции
// =====================================================================

test("во время заморозки правки целей не применяются и не меняют другие поля", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.2);
  assert.equal(targetInput(ctx, by.A).value, "0.2", "поле показывает введённое");
  near(by.A.targetProportion, 0.5, "модель не изменилась");
  near(by.B.targetProportion, 0.3, "B не тронута");
  near(by.C.targetProportion, 0.2, "C не тронута");
  assert.equal(targetInput(ctx, by.B).value, "0.3");
  assert.equal(targetInput(ctx, by.C).value, "0.2");
  type(ctx, targetInput(ctx, by.B), 0.5);
  assert.equal(targetInput(ctx, by.A).value, "0.2", "введённое прежде сохраняется");
  assert.equal(targetInput(ctx, by.B).value, "0.5");
  assert.equal(targetInput(ctx, by.C).value, "0.2", "C всё ещё не пересчитана");
  assert.equal(toastShown(ctx), false, "пока режим включён, ошибок нет");
  ctx.close();
});

test("три таймера: вводим нужные цели по очереди, выходим — всё применилось", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.2);
  type(ctx, targetInput(ctx, by.B), 0.5);
  type(ctx, targetInput(ctx, by.C), 0.3);
  toggle(ctx);
  assert.equal(isOn(ctx), false);
  assert.equal(toastShown(ctx), false, "без ошибок");
  near(by.A.targetProportion, 0.2, "A");
  near(by.B.targetProportion, 0.5, "B");
  near(by.C.targetProportion, 0.3, "C");
  near(ctx.sumTargets(), 1, "Σ целей");
  assert.equal(targetInput(ctx, by.B).value, "0.5");
  ctx.close();
});

test("при применении целей сумма весов сохраняется, веса следуют за целями", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  const before = weightSum(ctx);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.1);
  type(ctx, targetInput(ctx, by.B), 0.1);
  type(ctx, targetInput(ctx, by.C), 0.8);
  toggle(ctx);
  near(weightSum(ctx), before, "сумма весов", 1e-9);
  near(by.C.proportion / by.A.proportion, 8, "вес пропорционален цели", 1e-6);
  ctx.close();
});

test("сумма целей не равна 1: красная ошибка и откат к значениям до заморозки", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.1);
  type(ctx, targetInput(ctx, by.B), 0.1);
  toggle(ctx);
  assert.equal(isOn(ctx), false, "режим выключен");
  assert.equal(toastShown(ctx), true, "ошибка показана");
  assert.match(toast(ctx).textContent, /Целевые пропорции в сумме дают 0\.4, а должны давать 1/);
  assert.match(toast(ctx).textContent, /возвращены к тем, что были до заморозки/);
  near(by.A.targetProportion, 0.5);
  near(by.B.targetProportion, 0.3);
  near(by.C.targetProportion, 0.2);
  assert.equal(targetInput(ctx, by.A).value, "0.5", "поле вернулось");
  assert.equal(targetInput(ctx, by.B).value, "0.3");
  ctx.close();
});

test("ошибка показана красным (стиль тоста)", () => {
  const { ctx } = world([["A", 1]]);
  const css = [...ctx.document.querySelectorAll("style")].map(s => s.textContent).join("\n");
  const rule = /#appToast\s*\{[^}]*\}/.exec(css)[0];
  assert.match(rule, /color:\s*#ffd9de/);
  assert.match(rule, /border:\s*1px solid #ff7b8a/);
  ctx.close();
});

test("включение режима не меняет значения; выход без правок — тихо", () => {
  const { ctx, by } = world([["A", 0.6], ["B", 0.4]]);
  toggle(ctx);
  toggle(ctx);
  assert.equal(toastShown(ctx), false);
  near(by.A.targetProportion, 0.6);
  near(by.B.targetProportion, 0.4);
  ctx.close();
});

test("допуск: сумма 0.9996 принимается и точно нормируется к 1", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.3333);
  type(ctx, targetInput(ctx, by.B), 0.3333);
  type(ctx, targetInput(ctx, by.C), 0.3330);
  toggle(ctx);
  assert.equal(toastShown(ctx), false);
  near(ctx.sumTargets(), 1, "ровно 1", 1e-12);
  near(by.A.targetProportion, 0.3333, "значение почти как введено", 1e-3);
  ctx.close();
});

test("нечисловой ввод в режиме заморозки игнорируется, поле возвращается", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), "абв");
  assert.equal(targetInput(ctx, by.A).value, "0.5");
  type(ctx, targetInput(ctx, by.A), 0.25);
  type(ctx, targetInput(ctx, by.A), "xyz");
  assert.equal(targetInput(ctx, by.A).value, "0.25", "возвращено последнее введённое");
  type(ctx, targetInput(ctx, by.B), 0.75);
  toggle(ctx);
  near(by.A.targetProportion, 0.25);
  near(by.B.targetProportion, 0.75);
  ctx.close();
});

test("введённое вне [0, 1] обрезается до границ", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 5);
  assert.equal(targetInput(ctx, by.A).value, "1");
  type(ctx, targetInput(ctx, by.B), -3);
  assert.equal(targetInput(ctx, by.B).value, "0");
  toggle(ctx);
  near(by.A.targetProportion, 1);
  near(by.B.targetProportion, 0);
  ctx.close();
});

test("после выхода режим включается снова с чистого листа: прежние правки не воскресают", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.1);
  toggle(ctx); // сумма 0.6 → откат
  assert.equal(toastShown(ctx), true);
  toggle(ctx);
  assert.equal(ctx.FreezeMode.targets.size, 0);
  assert.equal(targetInput(ctx, by.A).value, "0.5");
  toggle(ctx);
  near(by.A.targetProportion, 0.5);
  ctx.close();
});

// =====================================================================
//  Доли
// =====================================================================

function groupWorld(n = 4) {
  const specs = [["Вне", 0.2]];
  for (let i = 1; i <= n; i++) specs.push([`T${i}`, 0.8 / n]);
  const { ctx, by } = world(specs);
  const folder = ctx.addFolder("Группа");
  for (let i = 1; i <= n; i++) ctx.moveToFolder(by[`T${i}`].id, folder.id);
  return { ctx, by, folder };
}
const shareOf = (ctx, t) => ctx.shareInput(t);

test("в группе из четырёх таймеров доли вводятся по очереди без пересчёта соседей", () => {
  const { ctx, by } = groupWorld(4);
  toggle(ctx);
  type(ctx, shareOf(ctx, by.T1), 0.1);
  assert.equal(shareOf(ctx, by.T1).value, "0.1000");
  assert.equal(shareOf(ctx, by.T2).value, "0.2500", "соседи не пересчитаны");
  assert.equal(shareOf(ctx, by.T3).value, "0.2500");
  near(by.T1.targetProportion, 0.2, "модель не изменилась");
  type(ctx, shareOf(ctx, by.T2), 0.2);
  assert.equal(shareOf(ctx, by.T3).value, "0.2500");
  type(ctx, shareOf(ctx, by.T3), 0.3);
  type(ctx, shareOf(ctx, by.T4), 0.4);
  toggle(ctx);
  assert.equal(toastShown(ctx), false);
  near(by.T1.targetProportion, 0.08, "10% от 0.8");
  near(by.T2.targetProportion, 0.16);
  near(by.T3.targetProportion, 0.24);
  near(by.T4.targetProportion, 0.32);
  near(by.Вне.targetProportion, 0.2, "вне группы ничего не изменилось");
  near(ctx.sumTargets(), 1);
  ctx.close();
});

test("после применения доли в карточках равны введённым", () => {
  const { ctx, by } = groupWorld(3);
  toggle(ctx);
  type(ctx, shareOf(ctx, by.T1), 0.5);
  type(ctx, shareOf(ctx, by.T2), 0.3);
  type(ctx, shareOf(ctx, by.T3), 0.2);
  toggle(ctx);
  near(ctx.shareValue(by.T1), 0.5);
  near(ctx.shareValue(by.T2), 0.3);
  near(ctx.shareValue(by.T3), 0.2);
  assert.equal(shareOf(ctx, by.T1).value, "0.5000");
  ctx.close();
});

test("сумма долей группы не 1: ошибка с названием группы и откат", () => {
  const { ctx, by } = groupWorld(3);
  toggle(ctx);
  type(ctx, shareOf(ctx, by.T1), 0.6);
  type(ctx, shareOf(ctx, by.T2), 0.3);
  toggle(ctx);
  assert.equal(toastShown(ctx), true);
  assert.match(toast(ctx).textContent, /Доли в группе «Группа» в сумме дают 1\.2333, а должны давать 1/);
  near(ctx.shareValue(by.T1), 1 / 3, "вернулась прежняя доля");
  assert.equal(shareOf(ctx, by.T1).value, (1 / 3).toFixed(4));
  near(by.T1.targetProportion, 0.8 / 3);
  ctx.close();
});

test("правятся доли только части сиблингов: остальные хранят свои доли, сумма 1", () => {
  const { ctx, by } = groupWorld(4);
  toggle(ctx);
  type(ctx, shareOf(ctx, by.T1), 0.4);
  type(ctx, shareOf(ctx, by.T2), 0.1);
  toggle(ctx);
  assert.equal(toastShown(ctx), false, "0.4 + 0.1 + 0.25 + 0.25 = 1");
  near(ctx.shareValue(by.T1), 0.4);
  near(ctx.shareValue(by.T2), 0.1);
  near(ctx.shareValue(by.T3), 0.25);
  near(ctx.shareValue(by.T4), 0.25);
  ctx.close();
});

test("доля в группе с вложенной группой: учитывается и доля группы-сиблинга", () => {
  const { ctx, by } = world([["Вне", 0.2], ["A", 0.2], ["B", 0.2], ["C", 0.2], ["D", 0.2]]);
  const outer = ctx.addFolder("Внешняя");
  const inner = ctx.addFolder("Внутренняя", ctx.TreeModel.findNode(outer.id).node);
  ctx.moveToFolder(by.A.id, outer.id);
  ctx.moveToFolder(by.B.id, outer.id);
  ctx.moveToFolder(by.C.id, inner.id);
  ctx.moveToFolder(by.D.id, inner.id);
  // во «Внешней»: A (0.2) + B (0.2) + «Внутренняя» (0.4): доли 0.25 / 0.25 / 0.5
  const innerShare = ctx.TreeModel.shareOf(inner.id);
  near(innerShare, 0.5);
  toggle(ctx);
  type(ctx, shareOf(ctx, by.A), 0.3);
  type(ctx, shareOf(ctx, by.B), 0.2);
  toggle(ctx);
  assert.equal(toastShown(ctx), false, "0.3 + 0.2 + 0.5 = 1");
  near(ctx.shareValue(by.A), 0.3);
  near(ctx.shareValue(by.B), 0.2);
  near(ctx.TreeModel.shareOf(inner.id), 0.5, "доля группы-сиблинга сохранилась");
  near(ctx.sumTargets(), 1);
  ctx.close();
});

test("нет откатов «вполовину»: ошибка в долях откатывает и цели", () => {
  const { ctx, by } = groupWorld(3);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.Вне), 0.5);
  type(ctx, targetInput(ctx, by.T1), 0.1);
  type(ctx, targetInput(ctx, by.T2), 0.2);
  type(ctx, targetInput(ctx, by.T3), 0.2); // Σ = 1.0
  type(ctx, shareOf(ctx, by.T1), 0.9); // доли группы: 0.9 + ?
  toggle(ctx);
  assert.equal(toastShown(ctx), true);
  near(by.Вне.targetProportion, 0.2, "цели откатились вместе с долями");
  near(by.T1.targetProportion, 0.8 / 3);
  ctx.close();
});

test("и цели, и доли заданы корректно — применяются обе правки", () => {
  const { ctx, by } = groupWorld(2);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.Вне), 0.5);
  type(ctx, targetInput(ctx, by.T1), 0.25);
  type(ctx, targetInput(ctx, by.T2), 0.25);
  type(ctx, shareOf(ctx, by.T1), 0.6);
  type(ctx, shareOf(ctx, by.T2), 0.4);
  toggle(ctx);
  assert.equal(toastShown(ctx), false);
  near(by.Вне.targetProportion, 0.5);
  near(by.T1.targetProportion, 0.3, "60% от 0.5");
  near(by.T2.targetProportion, 0.2, "40% от 0.5");
  near(ctx.sumTargets(), 1);
  ctx.close();
});

// =====================================================================
//  Взаимодействие с остальным интерфейсом
// =====================================================================

test("поле «Пропорция (вес)» в режиме заморозки работает как обычно", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  const input = ctx.elementOf(by.A, "proportion");
  type(ctx, input, 3);
  near(by.A.proportion, 3, "вес применяется сразу");
  near(by.A.targetProportion, 0.5);
  ctx.close();
});

test("пока режим включён, обновление экрана не затирает введённое", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.2);
  ctx.TimerView.syncAllProportionInputs();
  ctx.AppController.autoUpdate();
  assert.equal(targetInput(ctx, by.A).value, "0.2");
  ctx.close();
});

test("открытие «Конструктора дня» выключает режим (правки применяются)", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.25);
  type(ctx, targetInput(ctx, by.B), 0.75);
  ctx.click(byId(ctx, "menuButton"));
  ctx.click(ctx.document.querySelector('#operationsMenu button[data-action="day-builder"]'));
  assert.equal(isOn(ctx), false);
  near(by.A.targetProportion, 0.25);
  assert.ok(ctx.DayBuilder.isOpen());
  ctx.DayBuilder.close();
  ctx.close();
});

test("удалённый в режиме заморозки таймер не мешает выходу", () => {
  const { ctx, by } = world([["A", 0.4], ["B", 0.3], ["C", 0.3]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.C), 0.9);
  ctx.click(ctx.card(by.C).querySelector('button[data-action="delete"]'));
  type(ctx, targetInput(ctx, by.A), 0.5);
  type(ctx, targetInput(ctx, by.B), 0.5);
  toggle(ctx);
  assert.equal(toastShown(ctx), false);
  near(by.A.targetProportion, 0.5);
  near(by.B.targetProportion, 0.5);
  ctx.close();
});

test("после применения планы и рекомендации пересчитаны, в карточке нет NaN", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.1);
  type(ctx, targetInput(ctx, by.B), 0.1);
  type(ctx, targetInput(ctx, by.C), 0.8);
  toggle(ctx);
  assert.ok(by.C.plannedSeconds > by.A.plannedSeconds, "план следует за новыми целями");
  for (const t of [by.A, by.B, by.C]) {
    assert.doesNotMatch(ctx.card(t).textContent, /NaN|undefined/);
  }
  ctx.close();
});

test("применённое попадает в хранилище; отклонённое — нет", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.25);
  type(ctx, targetInput(ctx, by.B), 0.75);
  toggle(ctx);
  const stored = JSON.parse(ctx.window.localStorage.getItem("timers"));
  near(stored.find(t => t.name === "A").targetProportion, 0.25);
  toggle(ctx);
  type(ctx, targetInput(ctx, by.A), 0.9);
  toggle(ctx); // 0.9 + 0.75 ≠ 1 → откат
  ctx.StorageService.saveToLocalStorage();
  const again = JSON.parse(ctx.window.localStorage.getItem("timers"));
  near(again.find(t => t.name === "A").targetProportion, 0.25);
  ctx.close();
});

// =====================================================================
//  «Сохранить», «Экспорт», «Импорт» — в «Операциях»
// =====================================================================

test("«Сохранить», «Экспорт», «Импорт» убраны из панели и лежат в меню «Операции»", () => {
  const { ctx } = world([["A", 1]]);
  const top = [...ctx.document.querySelectorAll("#globalControls > button")].map(b => b.id);
  for (const id of ["saveTimersToLocalStorageManually", "exportButton", "importButton"]) {
    assert.ok(!top.includes(id), `${id} не в панели`);
    const el = byId(ctx, id);
    assert.ok(el, `${id} существует`);
    assert.equal(el.parentElement.id, "operationsMenu", `${id} — в меню`);
  }
  ctx.close();
});

test("пункты меню работают и закрывают меню", () => {
  const { ctx } = world([["A", 1]]);
  const calls = [];
  const ac = ctx.AppController;
  const orig = { s: ac.saveTimers, e: ac.exportTimers, i: ac.importTimers };
  ac.saveTimers = () => calls.push("save");
  ac.exportTimers = () => calls.push("export");
  ac.importTimers = () => calls.push("import");
  for (const id of ["saveTimersToLocalStorageManually", "exportButton", "importButton"]) {
    ctx.click(byId(ctx, "menuButton"));
    assert.ok(byId(ctx, "operationsMenu").classList.contains("visible"));
    ctx.click(byId(ctx, id));
    assert.equal(byId(ctx, "operationsMenu").classList.contains("visible"), false, "меню закрылось");
  }
  assert.deepEqual(calls, ["save", "export", "import"]);
  Object.assign(ac, { saveTimers: orig.s, exportTimers: orig.e, importTimers: orig.i });
  ctx.close();
});
