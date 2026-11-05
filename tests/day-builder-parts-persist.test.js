// «Конструктор дня»: Части переживают «Сохранить». На основном экране время
// сущности одно (Цель), а в окне Части остаются отдельными отрезками, пока
// живо дело, к которому они относятся (раскладка помнит доли и места слотов).
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll } = require("./harness.js");

after(closeAll);

const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);
const hm = text => {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
};
function world(specs) {
  const ctx = setup();
  const by = {};
  specs.forEach(([name, t]) => {
    by[name] = ctx.addTimer({ name, proportion: t, targetProportion: t });
  });
  return { ctx, by };
}
const D = ctx => ctx.DayDraft.fromMain();
const named = (d, name) =>
  d.all().filter(n => n.name === name).sort((a, b) => a.seq - b.seq);
const first = (d, name) => named(d, name)[0];
const put = (d, node, s, e) => d.setTime(node.id, hm(s), e === null ? null : hm(e));
const codes = d => Array.from(d.analyze().errors.map(e => e.code)).sort();
const timerOf = (ctx, name) => ctx.AppState.getTimers().find(t => t.name === name);
const sched = ctx => ctx.AppState.getSchedule();
const partsOf = (d, node) => d.all().filter(n => d.mainOf(n) && d.mainOf(n).id === node.id);

/** Йога 9–10, Работа 10–11 и Часть Йоги 11–12 → «Сохранить». */
function savedYoga() {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.createActivity("Йога", hm("11:00"), hm("12:00"));
  assert.equal(d.commit().ok, true);
  return { ctx, by };
}

// =====================================================================
//  Части видны при повторном открытии
// =====================================================================

test("повторное открытие: основная и Часть — отдельные сущности со своим временем", () => {
  const { ctx } = savedYoga();
  const d = D(ctx);
  const [main, part] = named(d, "Йога");
  assert.equal(named(d, "Йога").length, 2);
  assert.equal(d.isPart(main), false);
  assert.equal(d.isPart(part), true);
  assert.equal(d.mainOf(part).id, main.id);
  assert.equal(d.duration(main), 60);
  assert.equal(d.duration(part), 60);
  const times = named(d, "Йога").map(n => `${ctx.ScheduleModel.fmtStart(n.s)}-${ctx.ScheduleModel.fmtEnd(n.e)}`).sort();
  assert.equal(new Set(times).size, 2, "два разных отрезка");
  assert.deepEqual(codes(d), [], "расписание цело, ошибок нет");
  ctx.close();
});

test("на основном экране при этом один таймер с суммарной целью", () => {
  const { ctx, by } = savedYoga();
  assert.equal(ctx.AppState.getTimers().length, 2);
  near(by.Йога.targetProportion, 2 / 3, "Йога: 2 часа из 3");
  near(by.Работа.targetProportion, 1 / 3);
  near(ctx.sumTargets(), 1);
  ctx.close();
});

test("значок связи (звенья цепи) показан у Части после повторного открытия", () => {
  const { ctx } = savedYoga();
  ctx.DayBuilder.open();
  const rows = Array.from(ctx.document.querySelectorAll("#ddList .dd-row"));
  const linked = rows.filter(r => r.querySelector(".dd-link"));
  assert.equal(linked.length, 1);
  assert.equal(linked[0].querySelector(".dd-kind").textContent, "Часть активности");
  assert.ok(linked[0].querySelector(".dd-link svg"));
  assert.equal(rows.filter(r => r.querySelector(".dd-lock")).length, 0, "замков больше нет");
  ctx.DayBuilder.close();
  ctx.close();
});

test("повторное «Сохранить» без правок ничего не меняет", () => {
  const { ctx, by } = savedYoga();
  const before = JSON.stringify(sched(ctx));
  const targets = [by.Йога.targetProportion, by.Работа.targetProportion];
  const d = D(ctx);
  assert.equal(d.commit().ok, true);
  assert.equal(JSON.stringify(sched(ctx)), before, "раскладка прежняя");
  near(by.Йога.targetProportion, targets[0]);
  near(by.Работа.targetProportion, targets[1]);
  assert.equal(ctx.AppState.getTimers().length, 2, "новых таймеров нет");
  ctx.close();
});

test("снова и снова: открыть → сохранить 5 раз — Части и цели стабильны", () => {
  const { ctx, by } = savedYoga();
  for (let i = 0; i < 5; i++) {
    const d = D(ctx);
    assert.equal(named(d, "Йога").length, 2, `заход ${i}`);
    assert.equal(d.commit().ok, true);
  }
  near(by.Йога.targetProportion, 2 / 3);
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("раскладка с Частями переживает сериализацию (localStorage/облако)", () => {
  const { ctx } = savedYoga();
  const copy = JSON.parse(JSON.stringify(sched(ctx)));
  const clean = ctx.ScheduleModel.sanitize(copy);
  assert.deepEqual(plain(clean.slots), plain(sched(ctx).slots));
  assert.deepEqual(plain(clean.order.root), plain(sched(ctx).order.root));
  assert.ok(Object.keys(clean.slots).length === 1, "одна Часть");
  assert.ok(clean.order.root.some(k => typeof k === "string" && k.includes("~")), "ключ Части в порядке");
  ctx.close();
});

// =====================================================================
//  Части живут, пока жива основная сущность
// =====================================================================

test("правка цели на основном экране: отрезки основной и Части меняются пропорционально", () => {
  const { ctx, by } = savedYoga();
  // Йога 2/3 → 0.8: основная и Часть остаются поровну (1:1), «Работа» сжимается
  ctx.TreeModel.setTargetGlobal(by.Йога.id, 0.8);
  ctx.TreeModel.changed();
  const d = D(ctx);
  const [main, part] = named(d, "Йога");
  const total = 24 * 0; // не используем: проверяем отношения
  void total;
  near(d.duration(main) / d.duration(part), 1, "доли отрезков сохранились", 0.02);
  const work = first(d, "Работа");
  near((d.duration(main) + d.duration(part)) / d.duration(work), 4, "0.8 : 0.2", 0.05);
  ctx.close();
});

test("удалили дело на основном экране и завели такое же заново — Частей нет", () => {
  const { ctx, by } = savedYoga();
  ctx.click(ctx.card(by.Йога).querySelector('button[data-action="delete"]'));
  assert.equal(Object.keys(sched(ctx).slots).length, 0, "слоты ушли вместе с делом");
  ctx.addTimer({ name: "Йога", proportion: 0.5, targetProportion: 0.5 });
  ctx.TreeModel.changed();
  const d = D(ctx);
  assert.equal(named(d, "Йога").length, 1);
  assert.equal(d.all().filter(n => d.isPart(n)).length, 0);
  ctx.close();
});

test("переименование дела на основном экране переименовывает и его Часть", () => {
  const { ctx, by } = savedYoga();
  const input = ctx.card(by.Йога).querySelector('input[data-action="name"]');
  input.value = "Растяжка";
  ctx.change(input);
  const d = D(ctx);
  assert.equal(named(d, "Растяжка").length, 2);
  assert.equal(named(d, "Йога").length, 0);
  assert.equal(d.all().filter(n => d.isPart(n)).length, 1);
  ctx.close();
});

test("Часть обнулённого дела (цель 0) пропадает", () => {
  const { ctx, by } = savedYoga();
  ctx.TreeModel.setTargetGlobal(by.Йога.id, 0);
  ctx.TreeModel.changed();
  assert.equal(Object.keys(sched(ctx).slots).length, 0);
  assert.equal(named(D(ctx), "Йога").length, 1);
  ctx.close();
});

test("слияние на основном экране: Часть остаётся у дела, время растёт целиком", () => {
  const { ctx, by } = savedYoga();
  const extra = ctx.addTimer({ name: "Прогулка", proportion: 0, targetProportion: 0 });
  ctx.TreeModel.changed();
  ctx.MergeController.mergeIntoTimer(by.Йога.id, [extra.id]);
  assert.equal(ctx.AppState.getTimers().length, 2);
  const d = D(ctx);
  assert.equal(named(d, "Йога").length, 2);
  assert.deepEqual(codes(d), []);
  ctx.close();
});

test("разбиение дела с Частью на основном экране не оставляет мусора", () => {
  const { ctx, by } = savedYoga();
  ctx.AppController.splitTimer(
    by.Йога.id,
    [{ name: "Асаны", share: 0.5 }, { name: "Дыхание", share: 0.5 }],
    "Практика"
  );
  assert.equal(Object.keys(sched(ctx).slots).length, 0, "слоты прежнего таймера исчезли");
  const d = D(ctx);
  assert.deepEqual(codes(d), []);
  assert.equal(d.all().filter(n => d.isPart(n)).length, 0);
  ctx.close();
});

// =====================================================================
//  Правки Частей в окне
// =====================================================================

test("удалили Часть в окне и сохранили — основная держит только своё время", () => {
  const { ctx, by } = savedYoga();
  const d = D(ctx);
  const [, part] = named(d, "Йога");
  d.remove(part.id);
  put(d, first(d, "Работа"), "10:00", "12:00");
  assert.equal(d.commit().ok, true);
  assert.equal(Object.keys(sched(ctx).slots).length, 0);
  near(by.Йога.targetProportion, 1 / 3, "1 ч из 3");
  near(by.Работа.targetProportion, 2 / 3);
  assert.equal(named(D(ctx), "Йога").length, 1);
  ctx.close();
});

test("удалили основную сущность в окне — уходят и её Части, таймер удаляется", () => {
  const { ctx } = savedYoga();
  const d = D(ctx);
  d.remove(first(d, "Йога").id);
  put(d, first(d, "Работа"), "10:00", "11:00");
  assert.equal(d.commit().ok, true);
  assert.equal(timerOf(ctx, "Йога"), undefined);
  assert.equal(Object.keys(sched(ctx).slots).length, 0);
  ctx.close();
});

test("перенесли время Части и сохранили: на экране цели те же, в окне новое место", () => {
  const { ctx, by } = savedYoga();
  const d = D(ctx);
  const [, part] = named(d, "Йога");
  const work = first(d, "Работа");
  put(d, work, "11:00", "12:00");
  put(d, part, "10:00", "11:00");
  assert.deepEqual(codes(d), []);
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 2 / 3);
  const again = D(ctx);
  const [m2, p2] = named(again, "Йога");
  assert.equal(again.duration(p2), 60);
  const w2 = first(again, "Работа");
  assert.equal(ctx.ScheduleModel.norm(w2.s - p2.s), 60, "Работа после Части");
  void m2;
  ctx.close();
});

test("изменили длительность Части: цели и отрезки пересчитаны", () => {
  const { ctx, by } = savedYoga();
  const d = D(ctx);
  const [, part] = named(d, "Йога");
  put(d, part, "11:00", "13:00"); // было 1 ч, стало 2 ч
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 3 / 4, "1 ч + 2 ч из 4");
  const again = D(ctx);
  const [m2, p2] = named(again, "Йога");
  assert.equal(again.duration(m2), 60);
  assert.equal(again.duration(p2), 120);
  ctx.close();
});

test("несколько Частей одной сущности сохраняются и возвращаются по порядку", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "7:00", "8:00");
  put(d, first(d, "Работа"), "8:00", "12:00");
  d.createActivity("Йога", hm("12:00"), hm("13:00"));
  d.createActivity("йога", hm("13:00"), hm("15:00"));
  d.createActivity("ЙОГА", hm("15:00"), hm("15:30"));
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 4.5 / 8.5, "1 + 1 + 2 + 0.5 ч");
  const again = D(ctx);
  const list = named(again, "Йога");
  assert.equal(list.length, 4);
  const spans = list.map(n => again.duration(n)).sort((a, b) => a - b);
  assert.deepEqual(plain(spans), [30, 60, 60, 120]);
  assert.equal(again.all().filter(n => again.isPart(n)).length, 3);
  ctx.close();
});

test("основная сущность без собственного времени, только Части: после открытия основная пуста", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Работа"), "8:00", "12:00");
  d.setStart(first(d, "Йога").id, null);
  d.createActivity("Йога", hm("12:00"), hm("14:00"));
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 2 / 6);
  const again = D(ctx);
  const [main, part] = named(again, "Йога");
  assert.equal(again.timed(main), false, "у основной времени нет");
  assert.equal(again.duration(part), 120);
  assert.deepEqual(codes(again), []);
  assert.equal(again.commit().ok, true, "и повторное сохранение проходит");
  near(by.Йога.targetProportion, 2 / 6);
  ctx.close();
});

test("переименование основной в окне переименовывает все её Части", () => {
  const { ctx } = savedYoga();
  const d = D(ctx);
  const [main, part] = named(d, "Йога");
  d.rename(main.id, "Растяжка");
  assert.equal(part.name, "Растяжка");
  assert.equal(d.isPart(part), true);
  assert.equal(d.mainOf(part).id, main.id);
  assert.equal(d.commit().ok, true);
  assert.ok(timerOf(ctx, "Растяжка"));
  assert.equal(named(D(ctx), "Растяжка").length, 2);
  ctx.close();
});

test("переименование самой Части делает её самостоятельным делом", () => {
  const { ctx, by } = savedYoga();
  const d = D(ctx);
  const [, part] = named(d, "Йога");
  d.rename(part.id, "Медитация");
  assert.equal(d.isPart(part), false);
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.AppState.getTimers().length, 3, "появился отдельный таймер");
  near(by.Йога.targetProportion, 1 / 3);
  near(timerOf(ctx, "Медитация").targetProportion, 1 / 3);
  assert.equal(Object.keys(sched(ctx).slots).length, 0);
  ctx.close();
});

test("новую Часть можно добавить к уже имеющейся Части", () => {
  const { ctx, by } = savedYoga();
  const d = D(ctx);
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.createActivity("Йога", hm("12:00"), hm("13:00"));
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 3 / 4);
  assert.equal(named(D(ctx), "Йога").length, 3);
  ctx.close();
});

// =====================================================================
//  Группы
// =====================================================================

function groupWorld() {
  const { ctx, by } = world([["Лекции", 0.25], ["Задачи", 0.25], ["Тесты", 0.25], ["Отдых", 0.25]]);
  const course = ctx.addFolder("Курс");
  const practice = ctx.addFolder("Практика", ctx.TreeModel.findNode(course.id).node);
  ctx.moveToFolder(by.Лекции.id, course.id);
  ctx.moveToFolder(by.Задачи.id, practice.id);
  ctx.moveToFolder(by.Тесты.id, practice.id);
  return { ctx, by, course, practice };
}
/** Курс 9–10 (Лекции), Отдых 10–11 и Часть группы «Курс» 11–14: Задачи, Тесты, Лекции. */
function savedCourse() {
  const w = groupWorld();
  const { ctx } = w;
  const d = D(ctx);
  ["Практика", "Задачи", "Тесты"].forEach(n => d.setStart(first(d, n).id, null));
  put(d, first(d, "Курс"), "9:00", "10:00");
  put(d, first(d, "Лекции"), "9:00", "10:00");
  put(d, first(d, "Отдых"), "10:00", "11:00");
  const p = d.createGroup("Курс").node;
  put(d, p, "11:00", "14:00");
  const kid = n => d.descendants(p.id).find(x => x.name === n);
  put(d, kid("Практика"), "11:00", "13:00");
  put(d, kid("Задачи"), "11:00", "12:00");
  put(d, kid("Тесты"), "12:00", "13:00");
  put(d, kid("Лекции"), "13:00", "14:00");
  assert.deepEqual(codes(d), []);
  assert.equal(d.commit().ok, true);
  return w;
}

test("Часть группы с содержимым возвращается после повторного открытия со всеми связями", () => {
  const { ctx } = savedCourse();
  const d = D(ctx);
  const groups = named(d, "Курс");
  assert.equal(groups.length, 2, "основная группа и её Часть");
  const [mainG, partG] = groups;
  assert.equal(d.isPart(mainG), false);
  assert.equal(d.isPart(partG), true);
  assert.equal(d.duration(partG), 180);
  const inside = d.descendants(partG.id);
  assert.deepEqual(
    Array.from(inside.map(n => n.name)).sort(),
    ["Задачи", "Лекции", "Практика", "Тесты"]
  );
  assert.ok(inside.every(n => d.isPart(n)), "всё внутри — Части");
  assert.deepEqual(codes(d), []);
  assert.equal(ctx.TreeModel.allFolderNodes().filter(f => f.name === "Курс").length, 1, "на экране группа одна");
  ctx.close();
});

test("время содержимого Части группы сложилось с основным; повторное сохранение стабильно", () => {
  const { ctx, by } = savedCourse();
  // Лекции 1+1, Задачи 1, Тесты 1, Отдых 1 = 5 ч
  near(by.Лекции.targetProportion, 2 / 5);
  near(by.Задачи.targetProportion, 1 / 5);
  near(by.Тесты.targetProportion, 1 / 5);
  near(by.Отдых.targetProportion, 1 / 5);
  const snapshot = JSON.stringify(sched(ctx));
  const d = D(ctx);
  assert.equal(d.commit().ok, true);
  assert.equal(JSON.stringify(sched(ctx)), snapshot);
  near(ctx.sumTargets(), 1);
  ctx.close();
});

test("правка времени внутри Части группы после повторного открытия", () => {
  const { ctx, by } = savedCourse();
  const d = D(ctx);
  const partG = named(d, "Курс")[1];
  const kid = n => d.descendants(partG.id).find(x => x.name === n);
  put(d, partG, "11:00", "15:00");
  put(d, kid("Практика"), "11:00", "14:00");
  put(d, kid("Задачи"), "11:00", "13:00");
  put(d, kid("Тесты"), "13:00", "14:00");
  put(d, kid("Лекции"), "14:00", "15:00");
  assert.deepEqual(codes(d), []);
  assert.equal(d.commit().ok, true);
  // Лекции 1+1, Задачи 2, Тесты 1, Отдых 1 = 6 ч
  near(by.Задачи.targetProportion, 2 / 6);
  near(by.Лекции.targetProportion, 2 / 6);
  ctx.close();
});

test("Часть активности внутри группы, поставленная вне группы, возвращается на то же место", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const f = ctx.addFolder("Здоровье");
  ctx.moveToFolder(by.Йога.id, f.id);
  const d = D(ctx);
  put(d, first(d, "Здоровье"), "9:00", "11:00");
  put(d, first(d, "Йога"), "9:00", "11:00");
  put(d, first(d, "Работа"), "12:00", "14:00");
  const part = d.createActivity("Йога", hm("11:00"), hm("12:00")).node;
  assert.equal(part.parent, null);
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.TreeModel.parentOf(by.Йога.id).id, f.id, "Йога по-прежнему в «Здоровье»");
  const again = D(ctx);
  const [, p2] = named(again, "Йога");
  assert.equal(p2.parent, null, "Часть — на корне, как её и поставили");
  assert.equal(again.duration(p2), 60);
  assert.deepEqual(codes(again), []);
  assert.equal(again.commit().ok, true);
  near(by.Йога.targetProportion, 3 / 5);
  ctx.close();
});

test("основное, оказавшееся внутри Части группы, после сохранения остаётся в основной группе", () => {
  const { ctx } = groupWorld();
  const d = D(ctx);
  ["Практика", "Задачи", "Тесты"].forEach(n => d.setStart(first(d, n).id, null));
  put(d, first(d, "Курс"), "9:00", "10:00");
  put(d, first(d, "Лекции"), "9:00", "10:00");
  put(d, first(d, "Отдых"), "10:00", "11:00");
  const p = d.createGroup("Курс").node;
  put(d, p, "11:00", "13:00");
  d.remove(d.descendants(p.id).find(n => n.name === "Практика").id);
  d.remove(d.descendants(p.id).find(n => n.name === "Лекции").id);
  const extra = d.createActivity("Конспект", hm("11:00"), hm("13:00")).node;
  d.toGroup(extra.id, p.id);
  assert.equal(d.commit().ok, true);
  const course = ctx.TreeModel.allFolderNodes().find(f => f.name === "Курс");
  const timer = timerOf(ctx, "Конспект");
  assert.equal(ctx.TreeModel.parentOf(timer.id).id, course.id, "на экране — в «Курсе»");
  const again = D(ctx);
  const partG = named(again, "Курс")[1];
  const note = first(again, "Конспект");
  assert.equal(note.parent, partG.id, "в окне — внутри Части группы, где стоял по времени");
  assert.equal(again.commit().ok, true);
  assert.equal(ctx.TreeModel.parentOf(timer.id).id, course.id);
  ctx.close();
});

// =====================================================================
//  Хранилище и устойчивость
// =====================================================================

test("старые сохранения без слотов загружаются как прежде", () => {
  const SM = setup().ScheduleModel;
  const legacy = { saved: true, start: 60, end: 60, order: { root: [1, "2", 3.5], folders: { 1: [4] } }, startOnly: {} };
  const s = SM.sanitize(legacy);
  assert.deepEqual(plain(s.order.root), [1, 2, 3.5]);
  assert.deepEqual(plain(s.order.folders["1"]), [4]);
  assert.deepEqual(plain(s.slots), {});
});

test("sanitize отбрасывает мусорные ключи и поддерживает дробные id", () => {
  const SM = setup().ScheduleModel;
  const s = SM.sanitize({
    saved: true,
    order: { root: [7, "7~1", "12.5~2", "bad", "1~", null], folders: { "7~1": [3] } },
    slots: { "7~1": { f: 0.4 }, "12.5~2": {}, "bad": { f: 1 }, "7~x": { f: 1 } },
  });
  assert.deepEqual(plain(s.order.root), [7, "7~1", "12.5~2"]);
  assert.deepEqual(plain(Object.keys(s.slots).sort()), ["12.5~2", "7~1"]);
  assert.equal(s.slots["7~1"].f, 0.4);
  assert.deepEqual(plain(s.slots["12.5~2"]), {});
});

test("reconcile чистит слоты несуществующих дел и приводит доли к допустимым", () => {
  const { ctx, by } = savedYoga();
  const key = Object.keys(sched(ctx).slots)[0];
  sched(ctx).slots["99999~1"] = { f: 0.3 };
  sched(ctx).order.root.push("99999~1");
  sched(ctx).slots[`${by.Работа.id}~1`] = { f: 0.7 };
  sched(ctx).slots[`${by.Работа.id}~2`] = { f: 0.7 };
  ctx.ScheduleModel.reconcile();
  assert.equal(sched(ctx).slots["99999~1"], undefined);
  assert.ok(sched(ctx).slots[key], "настоящая Часть цела");
  const sum = ctx.ScheduleModel.partKeysOf(by.Работа.id).reduce((a, k) => a + sched(ctx).slots[k].f, 0);
  assert.ok(sum <= 1 + 1e-9, "доли Частей не превышают 1");
  ctx.close();
});

test("раскладка: суммарная длительность корневых слотов равна длине расписания", () => {
  const { ctx } = savedYoga();
  const lay = ctx.ScheduleModel.layout();
  const total = lay.root.reduce((s, e) => s + e.d, 0);
  near(total, lay.D, "Σ длительностей", 1e-6);
  assert.equal(lay.root.length, 3, "Йога, Работа и Часть Йоги");
  ctx.close();
});

test("перенос дела «В группу» на основном экране: слот Части не теряется и не дублируется", () => {
  const { ctx, by } = savedYoga();
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(by.Работа.id, f.id);
  ctx.TreeModel.changed();
  const keys = [];
  const walk = list => list.forEach(k => {
    keys.push(String(k));
    const sub = sched(ctx).order.folders[String(k)];
    if (sub) walk(sub);
  });
  walk(sched(ctx).order.root);
  assert.equal(new Set(keys).size, keys.length, "ключи не повторяются");
  const d = D(ctx);
  assert.equal(named(d, "Йога").length, 2);
  assert.deepEqual(codes(d), []);
  ctx.close();
});

// =====================================================================
//  Окно целиком (клики и поля)
// =====================================================================

const q = (ctx, sel) => ctx.document.querySelector(sel);
const rowsOf = ctx => Array.from(ctx.document.querySelectorAll("#ddList .dd-row"));
const rowByName = (ctx, name, k = 0) =>
  rowsOf(ctx).filter(r => r.querySelector(".dd-name").value === name)[k];
function editTime(ctx, name, k, start, end) {
  let r = rowByName(ctx, name, k);
  r.querySelector(".dd-start").value = start;
  ctx.change(r.querySelector(".dd-start"));
  r = rowByName(ctx, name, k);
  r.querySelector(".dd-end").value = end;
  ctx.change(r.querySelector(".dd-end"));
}
function openBuilder(ctx) {
  ctx.click(q(ctx, "#menuButton"));
  ctx.click(q(ctx, '#operationsMenu button[data-action="day-builder"]'));
}

test("окно: создали Часть, сохранили, открыли заново — Часть на месте со значком связи", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  openBuilder(ctx);
  editTime(ctx, "Йога", 0, "7:00", "8:00");
  editTime(ctx, "Работа", 0, "8:00", "17:00");
  ctx.click(q(ctx, 'button[data-dd-action="new-activity"]'));
  ctx.document.getElementById("ddNewName").value = "йога";
  ctx.document.getElementById("ddNewStart").value = "17:00";
  ctx.document.getElementById("ddNewEnd").value = "18:00";
  ctx.click(ctx.document.getElementById("ddCreateConfirm"));
  ctx.click(ctx.document.getElementById("ddSave"));
  assert.equal(ctx.DayBuilder.isOpen(), false);
  near(by.Йога.targetProportion, 2 / 11);
  openBuilder(ctx);
  const yoga = rowsOf(ctx).filter(r => /йога/i.test(r.querySelector(".dd-name").value));
  assert.equal(yoga.length, 2, "две строки: основная и Часть");
  assert.equal(yoga.filter(r => r.querySelector(".dd-link")).length, 1, "значок связи у Части");
  const starts = yoga.map(r => r.querySelector(".dd-start").value).sort();
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0], starts[1]);
  ctx.DayBuilder.close();
  ctx.close();
});

test("окно: переименование основной в поле названия переименовывает и строку Части", () => {
  const { ctx } = savedYoga();
  openBuilder(ctx);
  const input = rowByName(ctx, "Йога", 0).querySelector(".dd-name");
  input.value = "Растяжка";
  ctx.change(input);
  const renamed = rowsOf(ctx).filter(r => r.querySelector(".dd-name").value === "Растяжка");
  assert.equal(renamed.length, 2);
  assert.equal(renamed.filter(r => r.querySelector(".dd-link")).length, 1);
  ctx.DayBuilder.close();
  ctx.close();
});

test("после повторного открытия Часть по-прежнему нельзя поместить в другую группу", () => {
  const { ctx, by } = world([["Йога", 0.4], ["Работа", 0.3], ["Чтение", 0.3]]);
  const other = ctx.addFolder("Другая");
  ctx.moveToFolder(by.Чтение.id, other.id);
  const d = D(ctx);
  put(d, first(d, "Йога"), "7:00", "8:00");
  put(d, first(d, "Работа"), "8:00", "10:00");
  put(d, first(d, "Другая"), "10:00", "11:00");
  put(d, first(d, "Чтение"), "10:00", "11:00");
  d.createActivity("Йога", hm("11:00"), hm("12:00"));
  assert.equal(d.commit().ok, true);
  const again = D(ctx);
  const part = named(again, "Йога")[1];
  again.toGroup(part.id, first(again, "Другая").id);
  assert.ok(codes(again).includes("part-parent"));
  assert.equal(again.commit().ok, false);
  again.fromGroup(part.id);
  assert.ok(!codes(again).includes("part-parent"));
  ctx.close();
});

// =====================================================================
//  Случайные сценарии: сохранить → открыть → сравнить
// =====================================================================

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (let seed = 1; seed <= Number(process.env.PARTS_PERSIST_SEEDS || 20); seed++) {
  test(`случайные Части №${seed}: после «Сохранить» окно открывается с теми же отрезками`, () => {
    const rand = rng(seed * 7919 + 3);
    const n = 2 + Math.floor(rand() * 3);
    const specs = Array.from({ length: n }, (_, i) => [`Дело ${i}`, 1 / n]);
    const { ctx } = world(specs);
    const d = D(ctx);
    const segments = specs.map((_, i) => i);
    for (let k = 0; k < 1 + Math.floor(rand() * 5); k++) segments.push(Math.floor(rand() * n));
    segments.sort(() => rand() - 0.5);
    const planned = []; // { name, len }
    let cur = Math.floor(rand() * 24) * 60;
    const seen = new Set();
    let budget = 1440;
    for (const idx of segments) {
      const len = 15 * (1 + Math.floor(rand() * 8));
      if (len > budget) continue;
      budget -= len;
      const s = cur % 1440;
      const e = ctx.ScheduleModel.normEnd(cur + len);
      if (!seen.has(idx)) {
        seen.add(idx);
        d.setTime(first(d, specs[idx][0]).id, s, e);
      } else {
        d.createActivity(specs[idx][0], s, e);
      }
      planned.push([specs[idx][0], len, s]);
      cur += len;
    }
    if (seen.size < n) return ctx.close();
    assert.equal(d.commit().ok, true);
    const again = D(ctx);
    const got = again.all().filter(x => again.timed(x)).map(x => [x.name, again.duration(x)]);
    const want = planned.map(([name, len]) => [name, len]);
    const key = ([name, len]) => `${name}:${len}`;
    assert.deepEqual(plain(got.map(key).sort()), want.map(key).sort(), "те же отрезки");
    assert.deepEqual(codes(again), [], "ошибок нет");
    assert.equal(again.commit().ok, true, "повторное сохранение проходит");
    const third = D(ctx);
    assert.deepEqual(
      plain(third.all().filter(x => third.timed(x)).map(x => key([x.name, third.duration(x)])).sort()),
      want.map(key).sort(),
      "и ничего не поплыло"
    );
    near(ctx.sumTargets(), 1, "Σ целей");
    ctx.close();
  });
}
