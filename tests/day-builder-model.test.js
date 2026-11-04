// «Конструктор дня» (Требования-конструктор-дня-v3.md): модель расписания и
// черновик окна (DayDraft) — без DOM окна, прямыми вызовами.
//
// Разделы: 3 (сутки, «Начало»/«Конец»), 4 (циферблат), 5 (промежуток),
// 8 (порядок), 9 (создание, время, состав, «Пустое», длительность),
// 12 (удаление), 13 (инварианты).
// Синхронизация и окно — в day-builder-sync.test.js / day-builder-ui.test.js.
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll } = require("./harness.js");

after(closeAll);

const near = (a, b, msg, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);

/** "9:30" → минуты; "24:00" → 1440. */
const hm = text => {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
};

/** Контекст с таймерами по именам и Целями (сумма 1). */
function world(specs, opts = {}) {
  const ctx = setup();
  const by = {};
  specs.forEach(([name, target]) => {
    by[name] = ctx.addTimer({ name, proportion: target, targetProportion: target });
  });
  if (opts.end) ctx.setEndTime(opts.end);
  return { ctx, by };
}
const D = ctx => ctx.DayDraft.fromMain();
const byName = (d, name) => d.all().find(n => n.name === name);
/** Время узла в виде ["09:00","13:00"] (удобно сравнивать). */
const span = (ctx, d, name) => {
  const n = byName(d, name);
  const SM = ctx.ScheduleModel;
  return [n.s === null ? null : SM.fmtStart(n.s), n.e === null ? null : SM.fmtEnd(n.e)];
};
/** Задать интервал "9:00".."13:00" узлу по имени. */
const put = (d, name, s, e) => d.setTime(byName(d, name).id, hm(s), e === null ? null : hm(e));
const ids = (d, ...names) => names.map(n => byName(d, n).id);
const sorted = set => Array.from(set).sort();
const errCodes = d => Array.from(d.analyze().errors.map(e => e.code)).sort();

// =====================================================================
//  3. Основной экран: сутки, «Конец», «Начало»
// =====================================================================

test("3.2/11.3.6: Цели раскладываются на 24 часа; на основном экране нет промежутка", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  assert.deepEqual(span(ctx, d, "A"), ["00:00", "12:00"]);
  assert.deepEqual(span(ctx, d, "B"), ["12:00", "24:00"]);
  assert.equal(d.analyze().gapCount, 0);
  ctx.close();
});

test("3.3.4/13.14: «Начало (для конструктора)» и «Конец» по умолчанию 00:00", () => {
  const { ctx } = world([["A", 1]]);
  assert.equal(ctx.document.getElementById("scheduleStart").value, "00:00");
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.start, 0);
  assert.equal(sched.end, 0);
  assert.equal(sched.saved, false);
  ctx.close();
});

test("3.3.5/3.3.8: «Конец» влияет на «Начало»; без промежутка они совпадают, сутки от «Конца»", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]], { end: "21:00" });
  const d = D(ctx);
  // день на основном экране: от «Конца» до следующего «Конца» (3.1)
  assert.deepEqual(span(ctx, d, "A"), ["21:00", "09:00"]);
  assert.deepEqual(span(ctx, d, "B"), ["09:00", "21:00"]);
  assert.equal(ctx.AppState.getSchedule().start, hm("21:00"));
  assert.equal(ctx.document.getElementById("scheduleStart").value, "21:00");
  ctx.close();
});

test("3.3.1: «Начало» не влияет на Цели, планы и «Осталось»", () => {
  const { ctx, by } = world([["A", 0.6], ["B", 0.4]], { end: "20:00" });
  const d = D(ctx);
  put(d, "A", "9:00", "12:00");
  put(d, "B", "12:00", "14:00");
  assert.equal(d.commit().ok, true); // есть промежуток: «Начало» ≠ «Конец»
  ctx.recomputePlans();
  const plans = [by.A.plannedSeconds, by.B.plannedSeconds];
  const targets = [by.A.targetProportion, by.B.targetProportion];
  const endBefore = ctx.document.getElementById("globalEndTime").value;
  ctx.ScheduleModel.onStartField("07:30", true);
  ctx.ScheduleModel.onStartField("11:00", true);
  assert.equal(ctx.document.getElementById("globalEndTime").value, endBefore, "«Конец» не тронут");
  assert.deepEqual([by.A.plannedSeconds, by.B.plannedSeconds], plans);
  assert.deepEqual([by.A.targetProportion, by.B.targetProportion], targets);
  ctx.close();
});

test("3.4: «Конец» при промежутке сдвигает расписание монолитом, длительности и Цели те же", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  assert.equal(d.commit().ok, true);
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.start, hm("9:00"));
  assert.equal(sched.end, hm("13:00"));
  // пользователь меняет «Конец» на основном экране: 13:00 → 15:00
  ctx.setEndTime("15:00");
  ctx.ScheduleModel.onEndFieldCommitted();
  assert.equal(sched.start, hm("11:00"), "«Начало» сдвинулось на ту же величину");
  assert.equal(sched.end, hm("15:00"));
  const d2 = D(ctx);
  assert.deepEqual(span(ctx, d2, "A"), ["11:00", "13:00"]);
  assert.deepEqual(span(ctx, d2, "B"), ["13:00", "15:00"]);
  near(by.A.targetProportion, 0.5, "Цель A");
  assert.equal(ctx.ScheduleModel.hasGap(), true, "размер промежутка не изменился");
  ctx.close();
});

test("3.5: «Начало» при промежутке: первая активность начинается в указанное время, «Конец» тот же", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  d.commit();
  ctx.ScheduleModel.onStartField("08:00", true);
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.start, hm("8:00"));
  assert.equal(sched.end, hm("13:00"), "«Конец» не изменился (3.3.5)");
  const d2 = D(ctx);
  // расписание растянулось на 5 часов, Цели прежние (11.2)
  assert.deepEqual(span(ctx, d2, "A"), ["08:00", "10:30"]);
  assert.deepEqual(span(ctx, d2, "B"), ["10:30", "13:00"]);
  near(by.A.targetProportion, 0.5, "Цель A");
  ctx.close();
});

test("3.3.10/5.9/5.11: без промежутка «Конец» прилипает к ближайшему концу активности (14:54 → 15:00)", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  const d = D(ctx);
  put(d, "A", "15:00", "14:00"); // 23 часа: 15:00–14:00
  // проще: две активности, заканчивающиеся в 14:00 и 15:00 при полных сутках
  put(d, "A", "14:00", "15:00");
  put(d, "B", "15:00", "14:00");
  assert.equal(d.commit().ok, true);
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.saved, true);
  ctx.setEndTime("14:54");
  ctx.ScheduleModel.onEndFieldCommitted();
  assert.equal(sched.end, hm("15:00"), "«Конец» стал 15:00");
  assert.equal(ctx.document.getElementById("globalEndTime").value, "15:00");
  assert.equal(sched.start, hm("15:00"), "«Начало» совпало с «Концом» (3.3.8)");
  ctx.close();
});

test("3.3.8/5.10: без промежутка правка «Начала» тоже подтягивает «Конец»; Цели не меняются", () => {
  const { ctx, by } = world([["A", 0.25], ["B", 0.75]], { end: "00:00" });
  const d = D(ctx);
  assert.equal(d.commit().ok, true); // сохранили суточное расписание
  const before = [by.A.targetProportion, by.B.targetProportion];
  ctx.ScheduleModel.onStartField("05:00", true);
  const sched = ctx.AppState.getSchedule();
  // ближайшая граница к 05:00 — 06:00 (A: 00:00–06:00, B: 06:00–24:00)
  assert.equal(sched.start, hm("6:00"));
  assert.equal(sched.end, hm("6:00"));
  assert.equal(ctx.document.getElementById("globalEndTime").value, "06:00");
  assert.deepEqual([by.A.targetProportion, by.B.targetProportion], before);
  const d2 = D(ctx);
  assert.deepEqual(span(ctx, d2, "B"), ["06:00", "24:00"]);
  assert.deepEqual(span(ctx, d2, "A"), ["00:00", "06:00"]);
  ctx.close();
});

test("3.6: суточный переход основного экрана не трогает расписание", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  d.commit();
  const snapshot = JSON.stringify(ctx.AppState.getSchedule());
  const before = D(ctx).all().map(n => [n.name, n.s, n.e]);
  ctx.clock.advance(30 * 3600 * 1000); // больше суток: «Конец» наступил, новый день
  ctx.tick();
  ctx.tick();
  assert.equal(JSON.stringify(ctx.AppState.getSchedule()), snapshot, "расписание то же");
  assert.deepEqual(D(ctx).all().map(n => [n.name, n.s, n.e]), before, "интервалы те же");
  ctx.close();
});

// =====================================================================
//  4. Циферблат
// =====================================================================

test("4.1/4.2/4.3: разбор времени — часы и минуты, конец 00:00 = 24:00", () => {
  const { ctx } = world([["A", 1]]);
  const SM = ctx.ScheduleModel;
  assert.equal(SM.parseStart("9:05"), 545);
  assert.equal(SM.parseStart("09:05:30"), null, "секунд нет");
  assert.equal(SM.parseStart("24:00"), null, "24:00 — только конец");
  assert.equal(SM.parseStart("12:60"), null);
  assert.equal(SM.parseEnd("24:00"), 1440);
  assert.equal(SM.parseEnd("00:00"), 1440, "конец в полночь записывается как 24:00");
  assert.equal(SM.parseEnd("24:01"), null);
  assert.equal(SM.parseEnd(""), null);
  assert.equal(SM.fmtEnd(1440), "24:00");
  assert.equal(SM.fmtStart(0), "00:00");
  assert.equal(SM.fmtStart(1440), "00:00");
  ctx.close();
});

test("4.4: соседние активности вплотную (00:00–1:00 и 1:00–2:00) — не пересечение", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "0:00", "1:00");
  put(d, "B", "1:00", "2:00");
  assert.deepEqual(errCodes(d), []);
  ctx.close();
});

test("4.6/13.6: равные начало и конец (1:00–1:00) — 24 часа", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  put(d, "A", "1:00", "1:00");
  const n = byName(d, "A");
  assert.equal(d.duration(n), 1440);
  assert.equal(ctx.ScheduleModel.fmtDur(d.duration(n)), "24ч 0м");
  assert.equal(d.analyze().gapCount, 0);
  ctx.close();
});

test("4.6: длительность указанного интервала — от 1 минуты до 24 часов", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  put(d, "A", "10:00", "10:01");
  assert.equal(d.duration(byName(d, "A")), 1);
  put(d, "A", "10:00", "9:59");
  assert.equal(d.duration(byName(d, "A")), 1439);
  ctx.close();
});

test("4.9: две активности 9:00–9:30 и 9:30–10:00 дают расписание в час и промежуток 23 часа", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "9:00", "9:30");
  put(d, "B", "9:30", "10:00");
  const an = d.analyze();
  assert.equal(an.gapCount, 1);
  near(an.rootHoles[0].len, 23 * 60, "промежуток");
  assert.equal(d.commit().ok, true);
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.start, hm("9:00"), "«Начало»");
  assert.equal(sched.end, hm("10:00"), "«Конец»");
  near(by.A.targetProportion, 0.5, "Цель A");
  ctx.close();
});

test("4.10: расписание через полночь допустимо (22:00–02:00 и 02:00–06:00)", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "22:00", "2:00");
  put(d, "B", "2:00", "6:00");
  const an = d.analyze();
  assert.deepEqual(errCodes(d), []);
  assert.equal(an.gapCount, 1);
  assert.equal(an.rootHoles[0].to, hm("22:00"), "промежуток 06:00–22:00, первая — A");
  assert.equal(d.commit().ok, true);
  near(by.A.targetProportion, 0.5, "Цель A");
  assert.equal(ctx.AppState.getSchedule().start, hm("22:00"));
  assert.equal(ctx.AppState.getSchedule().end, hm("6:00"));
  ctx.close();
});

// =====================================================================
//  5. Промежуток
// =====================================================================

test("5.1/9.3.7: больше одного промежутка — ошибка и красная подсветка граничащих", () => {
  const { ctx } = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]]);
  const d = D(ctx);
  put(d, "A", "8:00", "9:00");
  put(d, "B", "11:00", "12:00");
  put(d, "C", "15:00", "16:00");
  const an = d.analyze();
  assert.equal(an.gapCount, 3);
  assert.ok(errCodes(d).includes("gaps"));
  assert.equal(an.canSave, false);
  assert.equal(an.blue.size, 0, "синяя подсветка при нескольких промежутках гаснет");
  assert.deepEqual(sorted(an.red), sorted(ids(d, "A", "B", "C")));
  assert.equal(d.commit().ok, false, "сохранение заблокировано");
  ctx.close();
});

test("5.7/9.3.5: единственный промежуток подсвечивает две соседние активности синим", () => {
  const { ctx } = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]]);
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  put(d, "C", "13:00", "15:00");
  const an = d.analyze();
  assert.equal(an.gapCount, 1);
  assert.deepEqual(sorted(an.blue), sorted(ids(d, "A", "C")), "синие — первая и последняя");
  assert.equal(an.red.size, 0);
  // промежуток исчез (C дотянулась до начала A через полночь) — синего нет
  put(d, "C", "13:00", "9:00");
  const an2 = d.analyze();
  assert.equal(an2.gapCount, 0);
  assert.equal(an2.blue.size, 0);
  ctx.close();
});

test("5.3.2/5.3.3/13.3: Цель = длительность / длительность расписания; одна активность — Цель 1", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "13:00");
  d.commit();
  near(by.A.targetProportion, 0.25, "Цель A");
  near(by.B.targetProportion, 0.75, "Цель B");
  const one = world([["X", 1]]);
  const d1 = D(one.ctx);
  put(d1, "X", "13:00", "14:00");
  d1.commit();
  near(one.by.X.targetProportion, 1, "одна активность — весь день");
  ctx.close();
  one.ctx.close();
});

test("5.4/9.4.5: свободное время внутри группы — ошибка, подсвечены группа и граничащие дети", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("13:00"));
  d.toGroup(byName(d, "A").id, g.id);
  d.toGroup(byName(d, "B").id, g.id);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "12:00", "13:00"); // 10:00–12:00 свободно
  const an = d.analyze();
  assert.ok(errCodes(d).includes("group-free"));
  assert.ok(an.red.has(g.id));
  assert.ok(an.red.has(byName(d, "A").id) && an.red.has(byName(d, "B").id));
  assert.equal(d.commit().ok, false);
  put(d, "B", "10:00", "13:00");
  assert.deepEqual(errCodes(d), []);
  ctx.close();
});

test("5.12/3.4: при промежутке «Конец» не прилипает — только монолитный сдвиг", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "11:00");
  d.commit();
  ctx.setEndTime("14:54");
  ctx.ScheduleModel.onEndFieldCommitted();
  assert.equal(ctx.AppState.getSchedule().end, hm("14:54"), "значение осталось как введено");
  assert.equal(ctx.document.getElementById("globalEndTime").value, "14:54");
  ctx.close();
});

// =====================================================================
//  8. Порядок
// =====================================================================

test("8.1/8.2: порядок списка — по времени начала; обмен времён меняет порядок", () => {
  const { ctx } = world([["Первая", 0.5], ["Вторая", 0.5]]);
  const d = D(ctx);
  put(d, "Первая", "7:00", "8:00");
  put(d, "Вторая", "10:00", "11:00");
  const order = () => Array.from(d.rows().map(r => r.node.name));
  assert.deepEqual(order(), ["Первая", "Вторая"]);
  put(d, "Первая", "10:00", "11:00");
  put(d, "Вторая", "7:00", "8:00");
  assert.deepEqual(order(), ["Вторая", "Первая"]);
  ctx.close();
});

test("8.1/9.3.9: точка отсчёта — сразу после единственного промежутка", () => {
  const { ctx } = world([["Вечер", 0.5], ["Утро", 0.5]]);
  const d = D(ctx);
  put(d, "Вечер", "22:00", "23:00");
  put(d, "Утро", "6:00", "7:00");
  // два промежутка → отсчёт от 00:00: Утро раньше
  assert.deepEqual(Array.from(d.rows().map(r => r.node.name)), ["Утро", "Вечер"]);
  put(d, "Утро", "23:00", "7:00"); // теперь один промежуток 7:00–22:00, первая — Вечер
  put(d, "Вечер", "22:00", "23:00");
  assert.equal(d.analyze().gapCount, 1);
  assert.deepEqual(Array.from(d.rows().map(r => r.node.name)), ["Вечер", "Утро"]);
  ctx.close();
});

test("8.3: начало активности внутри интервала группы кладёт её в эту группу", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Работа").node;
  d.setTime(g.id, hm("9:00"), hm("13:00"));
  put(d, "A", "10:00", "11:00");
  assert.equal(byName(d, "A").parent, g.id, "A оказалась в группе по времени начала");
  put(d, "A", "14:00", "15:00");
  assert.equal(byName(d, "A").parent, g.id, "уход начала за границу сам не выселяет (конфликт «вне группы»)");
  assert.ok(errCodes(d).includes("outside"));
  ctx.close();
});

test("8.3/4.7.1: элемент без конца тоже вкладывается по началу, но блокирует сохранение", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("12:00"));
  const res = d.createActivity("Без конца", hm("10:00"), null);
  assert.equal(res.node.parent, g.id, "вложена по началу");
  assert.ok(errCodes(d).includes("group-free"), "в группе свободное время");
  assert.equal(d.commit().ok, false);
  ctx.close();
});

test("8.4/13.9: порядок на основном экране и порядок конструктора независимы", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "12:00", "14:00");
  put(d, "B", "10:00", "12:00");
  d.commit();
  const mainOrder = Array.from(ctx.TreeModel.root().map(n => n.id));
  assert.deepEqual(mainOrder, [by.A.id, by.B.id], "порядок основного экрана прежний");
  const names = Array.from(D(ctx).rows().map(r => r.node.name));
  assert.deepEqual(names, ["B", "A"], "в конструкторе — по времени");
  ctx.close();
});

// =====================================================================
//  9. Создание, время, состав
// =====================================================================

test("9.2: название обязательно, время — нет; активность без времени уходит в «Пустое»", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  assert.equal(d.createActivity("  ", null, null).ok, false, "без названия нельзя");
  const res = d.createActivity("Новая", null, null);
  assert.equal(res.ok, true);
  const row = d.rows().find(r => r.node.name === "Новая");
  assert.equal(row.section, "empty");
  assert.equal(res.node.parent, null, "на корневом уровне (9.2.4)");
  ctx.close();
});

test("9.2.2: у времени нет значений по умолчанию; первая активность — как ввёл пользователь", () => {
  const ctx = setup();
  const d = D(ctx);
  const res = d.createActivity("Первая", hm("9:00"), hm("11:00"));
  assert.deepEqual([res.node.s, res.node.e], [540, 660]);
  assert.equal(d.createActivity("Без начала", null, hm("12:00")).ok, false, "конец без начала нельзя");
  ctx.close();
});

test("9.2.5: группа создаётся с названием и до указания начала лежит в «Пустом»", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  assert.equal(d.createGroup("").ok, false);
  const g = d.createGroup("Группа").node;
  assert.equal(d.rows().find(r => r.node.id === g.id).section, "empty");
  d.setStart(g.id, hm("9:00"));
  assert.equal(d.rows().find(r => r.node.id === g.id).section, "main", "с началом — в основном списке (9.6.3)");
  ctx.close();
});

test("9.3.1/9.3.2/9.3.3: пересечение вводить можно, красная подсветка сразу, уходит после исправления", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "10:00", "12:00");
  const an = d.analyze();
  assert.deepEqual(errCodes(d), ["overlap"]);
  assert.deepEqual(sorted(an.red), sorted(ids(d, "A", "B")));
  assert.equal(d.commit().ok, false, "изменения не применяются, пока конфликт не устранён (9.3.6)");
  put(d, "B", "11:00", "12:00");
  assert.equal(d.analyze().red.size, 0);
  ctx.close();
});

test("9.3.6: блокированное сохранение ничего не меняет на основном экране", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "10:00", "12:00");
  d.rename(by.A.id, "Переименована");
  d.createActivity("Новая", hm("1:00"), hm("2:00"));
  const targets = [by.A.targetProportion, by.B.targetProportion];
  assert.equal(d.commit().ok, false);
  assert.equal(by.A.name, "A", "имя не изменилось");
  assert.equal(ctx.AppState.getTimers().length, 2, "новый таймер не создан");
  assert.deepEqual([by.A.targetProportion, by.B.targetProportion], targets);
  ctx.close();
});

test("9.4.2: время группы меняется — содержимое сжимается/расширяется равнопропорционально", () => {
  const { ctx } = world([["A", 0.25], ["B", 0.75]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("8:00"), hm("12:00"));
  d.toGroup(byName(d, "A").id, g.id);
  d.toGroup(byName(d, "B").id, g.id);
  put(d, "A", "8:00", "9:00");
  put(d, "B", "9:00", "12:00");
  assert.deepEqual(errCodes(d), []);
  d.setTime(g.id, hm("8:00"), hm("10:00")); // группа вдвое короче
  assert.deepEqual(span(ctx, d, "A"), ["08:00", "08:30"]);
  assert.deepEqual(span(ctx, d, "B"), ["08:30", "10:00"]);
  d.setTime(g.id, hm("8:00"), hm("14:00")); // втрое длиннее
  assert.deepEqual(span(ctx, d, "A"), ["08:00", "09:30"]);
  assert.deepEqual(span(ctx, d, "B"), ["09:30", "14:00"]);
  assert.deepEqual(errCodes(d), [], "после масштабирования конфликтов нет");
  ctx.close();
});

test("9.4.2: правка начала группы тоже масштабирует и сдвигает вложенные группы", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const outer = d.createGroup("Внешняя").node;
  const inner = d.createGroup("Внутренняя").node;
  d.setTime(outer.id, hm("8:00"), hm("12:00"));
  d.setTime(inner.id, hm("8:00"), hm("10:00"));
  d.toGroup(inner.id, outer.id);
  d.toGroup(byName(d, "A").id, inner.id);
  d.toGroup(byName(d, "B").id, outer.id);
  put(d, "A", "8:00", "10:00");
  put(d, "B", "10:00", "12:00");
  assert.deepEqual(errCodes(d), []);
  d.setTime(outer.id, hm("9:00"), hm("13:00")); // тот же размер — просто сдвиг
  assert.deepEqual(span(ctx, d, "Внутренняя"), ["09:00", "11:00"]);
  assert.deepEqual(span(ctx, d, "A"), ["09:00", "11:00"]);
  assert.deepEqual(span(ctx, d, "B"), ["11:00", "13:00"]);
  ctx.close();
});

test("9.4.3/13.19: время группы не меняется при изменении состава", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("8:00"), hm("10:00"));
  d.toGroup(byName(d, "A").id, g.id);
  put(d, "A", "8:00", "10:00");
  const before = span(ctx, d, "Группа");
  d.toGroup(byName(d, "B").id, g.id);
  assert.deepEqual(span(ctx, d, "Группа"), before, "после «В группу»");
  d.fromGroup(byName(d, "A").id);
  assert.deepEqual(span(ctx, d, "Группа"), before, "после «Из группы»");
  d.remove(byName(d, "B").id);
  assert.deepEqual(span(ctx, d, "Группа"), before, "после удаления");
  ctx.close();
});

test("9.4.6/9.4.7: сжатие, при котором содержимое короче минуты, не применяется — группа красная", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("8:00"), hm("8:10"));
  d.toGroup(byName(d, "A").id, g.id);
  d.toGroup(byName(d, "B").id, g.id);
  put(d, "A", "8:00", "8:05");
  put(d, "B", "8:05", "8:10");
  d.setTime(g.id, hm("8:00"), hm("8:01")); // 1 минута на двух: так нельзя
  assert.deepEqual(span(ctx, d, "A"), ["08:00", "08:05"], "значения содержимого не применены");
  const an = d.analyze();
  assert.ok(an.red.has(g.id), "группа подсвечена красным");
  assert.equal(d.commit().ok, false);
  d.setTime(g.id, hm("8:00"), hm("8:10")); // увеличили
  assert.equal(d.analyze().red.size, 0);
  ctx.close();
});

test("9.4.8/9.4.9: время пустой группы редактируемо, но с длительностью больше нуля это ошибка", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  const g = d.createGroup("Пустая").node;
  d.setTime(g.id, hm("13:00"), hm("13:30"));
  assert.deepEqual(span(ctx, d, "Пустая"), ["13:00", "13:30"], "время задалось");
  assert.ok(errCodes(d).includes("group-empty"));
  assert.equal(d.commit().ok, false);
  d.setEnd(g.id, null); // убрали конец — группа без времени
  assert.deepEqual(errCodes(d), []);
  ctx.close();
});

test("9.4.10/9.4.11/12.6: группа без времени сохраняется, границы и Цели не затрагивает", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "12:00");
  const g = d.createGroup("Без времени").node;
  d.setStart(g.id, hm("15:00")); // начало есть, конца нет — «без времени»
  assert.deepEqual(errCodes(d), []);
  const r = d.commit();
  assert.equal(r.ok, true);
  assert.equal(ctx.AppState.getSchedule().end, hm("12:00"), "граница не зависит от группы");
  near(by.A.targetProportion + by.B.targetProportion, 1, "Σ Целей");
  const saved = ctx.TreeModel.allFolderNodes().find(f => f.name === "Без времени");
  assert.ok(saved, "группа перенесена");
  assert.equal(saved.children.length, 0, "как группа без таймеров");
  ctx.close();
});

test("9.4.12/9.3.7: группа без времени, у которой есть содержимое, блокирует сохранение", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.toGroup(byName(d, "A").id, g.id);
  put(d, "A", "9:00", "10:00");
  assert.ok(errCodes(d).includes("group-no-time"));
  d.setTime(g.id, hm("9:00"), hm("10:00"));
  assert.deepEqual(errCodes(d), []);
  ctx.close();
});

test("9.5.3/9.5.4/13.21: «В группу» выравнивает начало добавляемой сущности, остальным не мешает", () => {
  const { ctx } = world([["A", 0.4], ["B", 0.3], ["C", 0.3]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("12:00"));
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "12:00");
  put(d, "C", "15:00", "16:00");
  const sibling = span(ctx, d, "A");
  d.toGroup(byName(d, "C").id, g.id);
  assert.deepEqual(span(ctx, d, "C"), ["09:00", "10:00"], "начало = началу группы, длительность прежняя");
  assert.deepEqual(span(ctx, d, "B"), ["10:00", "12:00"], "остальные не двигались");
  assert.deepEqual(span(ctx, d, "Группа"), ["09:00", "12:00"]);
  assert.ok(sibling[0] === span(ctx, d, "A")[0]);
  // A и C теперь начинаются одновременно — фактическое пересечение (9.5.4)
  assert.ok(errCodes(d).includes("overlap"));
  ctx.close();
});

test("9.5.3: у группы без времени выравнивать нечего — время сущности прежнее, сохранение заблокировано", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  const g = d.createGroup("Группа").node;
  assert.equal(d.toGroup(byName(d, "A").id, g.id).ok, true);
  assert.deepEqual(span(ctx, d, "A"), ["09:00", "10:00"]);
  assert.ok(errCodes(d).includes("group-no-time"));
  ctx.close();
});

test("9.5.6: «В группу» доступна группам (в т.ч. пустым и без времени), активности без времени — нет", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const g = d.createGroup("Пустая").node;
  const free = d.createActivity("Без времени", null, null).node;
  const startOnly = d.createActivity("Только начало", hm("5:00"), null).node;
  assert.equal(d.canMoveToGroup(g.id), true);
  assert.equal(d.canMoveToGroup(byName(d, "A").id), true);
  assert.equal(d.canMoveToGroup(free.id), false);
  assert.equal(d.canMoveToGroup(startOnly.id), false, "нет временного диапазона");
  assert.equal(d.toGroup(free.id, g.id).ok, false);
  d.setEnd(startOnly.id, hm("6:00"));
  assert.equal(d.canMoveToGroup(startOnly.id), true, "диапазон указан — кнопка доступна");
  ctx.close();
});

test("9.5.5/9.5.15/13.23: границы дочерней и родительской групп могут совпадать, вложенность задаёт кнопка", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const outer = d.createGroup("Внешняя").node;
  const inner = d.createGroup("Внутренняя").node;
  d.setTime(outer.id, hm("9:00"), hm("12:00"));
  d.setTime(inner.id, hm("9:00"), hm("12:00"));
  assert.ok(errCodes(d).includes("overlap"), "пока обе корневые — пересекаются");
  assert.equal(d.toGroup(inner.id, outer.id).ok, true);
  d.toGroup(byName(d, "A").id, inner.id);
  put(d, "A", "9:00", "12:00");
  assert.deepEqual(errCodes(d), [], "совпадение границ — не конфликт");
  assert.equal(d.toGroup(outer.id, inner.id).ok, false, "нельзя группу внутрь её потомка");
  assert.equal(d.toGroup(outer.id, outer.id).ok, false, "и внутрь самой себя");
  ctx.close();
});

test("9.5.8/9.5.11: удаление конца у активности в группе оставляет её в группе — в группе свободное время", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("11:00"));
  d.toGroup(byName(d, "A").id, g.id);
  d.toGroup(byName(d, "B").id, g.id);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "11:00");
  assert.deepEqual(errCodes(d), []);
  d.setEnd(byName(d, "B").id, null);
  const b = byName(d, "B");
  assert.equal(b.parent, g.id, "осталась в составе группы");
  assert.equal(b.s, hm("10:00"), "начало сохранилось");
  assert.equal(b.e, null);
  assert.deepEqual(span(ctx, d, "Группа"), ["09:00", "11:00"], "время группы не менялось");
  assert.ok(errCodes(d).includes("group-free"));
  assert.equal(d.rows().find(r => r.node.id === b.id).section, "main", "в основном списке, не в «Пустом»");
  ctx.close();
});

test("9.5.10/13.22: «Из группы» сохраняет длительность, начало = концу группы", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("12:00"));
  d.toGroup(byName(d, "A").id, g.id);
  d.toGroup(byName(d, "B").id, g.id);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "12:00");
  d.fromGroup(byName(d, "A").id);
  const a = byName(d, "A");
  assert.equal(a.parent, null, "на корневом уровне");
  assert.deepEqual(span(ctx, d, "A"), ["12:00", "13:00"], "начало = концу группы, длительность 1 час");
  assert.deepEqual(span(ctx, d, "Группа"), ["09:00", "12:00"], "время группы не менялось (9.5.11)");
  assert.ok(errCodes(d).includes("group-free"), "в группе образовалось свободное место");
  ctx.close();
});

test("9.5.10: из вложенной группы сущность уходит к концу ближайшей КОРНЕВОЙ группы", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const outer = d.createGroup("Внешняя").node;
  const inner = d.createGroup("Внутренняя").node;
  d.setTime(outer.id, hm("8:00"), hm("14:00"));
  d.setTime(inner.id, hm("8:00"), hm("10:00"));
  d.toGroup(inner.id, outer.id);
  put(d, "A", "8:00", "9:00");
  d.toGroup(byName(d, "A").id, inner.id);
  put(d, "A", "8:00", "9:00");
  d.fromGroup(byName(d, "A").id);
  assert.equal(byName(d, "A").parent, null, "на корневом уровне, а не в Внешней");
  assert.deepEqual(span(ctx, d, "A"), ["14:00", "15:00"]);
  ctx.close();
});

test("9.5.12: время сущности вне интервала её группы — красный конфликт", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("10:00"));
  d.toGroup(byName(d, "A").id, g.id);
  put(d, "A", "9:30", "10:30");
  const an = d.analyze();
  assert.ok(errCodes(d).includes("outside"));
  assert.ok(an.red.has(byName(d, "A").id));
  ctx.close();
});

test("9.6: «Пустое» — только элементы без начала и конца; сначала группы, потом активности, по алфавиту", () => {
  const ctx = setup();
  const d = D(ctx);
  d.createActivity("Ящик", null, null);
  d.createActivity("Арбуз", null, null);
  d.createGroup("Яблоня");
  d.createGroup("Берёза");
  d.createActivity("Только начало", hm("5:00"), null);
  const rows = d.rows();
  const empty = Array.from(rows.filter(r => r.section === "empty").map(r => r.node.name));
  assert.deepEqual(empty, ["Берёза", "Яблоня", "Арбуз", "Ящик"], "группы, затем активности, по алфавиту (9.6.8)");
  const main = Array.from(rows.filter(r => r.section === "main").map(r => r.node.name));
  assert.deepEqual(main, ["Только начало"], "только начало — в основном списке (9.6.3/4.7.1)");
  ctx.close();
});

test("9.6.5: время, заданное прямо в «Пустом», переносит элемент в основной список по началу", () => {
  const ctx = setup();
  const d = D(ctx);
  d.createActivity("Поздняя", hm("20:00"), hm("21:00"));
  d.createActivity("Раньше", hm("5:00"), null);
  const free = d.createActivity("Свободная", null, null).node;
  assert.equal(d.rows().find(r => r.node.id === free.id).section, "empty");
  d.setStart(free.id, hm("7:00"));
  const rows = d.rows();
  assert.equal(rows.find(r => r.node.id === free.id).section, "main");
  assert.deepEqual(
    Array.from(rows.map(r => r.node.name)),
    ["Поздняя", "Раньше", "Свободная"],
    "в позиции по началу (отсчёт от начала после промежутка)"
  );
  d.setEnd(free.id, hm("8:00"));
  assert.equal(d.duration(byName(d, "Свободная")), 60, "конец даёт длительность");
  ctx.close();
});

test("4.7/9.6.2: удалить конец можно корзиной — начало остаётся, длительность — прочерк", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  d.setEnd(byName(d, "A").id, null);
  const a = byName(d, "A");
  assert.equal(a.s, hm("9:00"));
  assert.equal(a.e, null);
  assert.equal(d.duration(a), null);
  assert.equal(ctx.ScheduleModel.fmtDur(d.duration(a)), "—", "9.7.1/4.7.2");
  assert.equal(d.rows().find(r => r.node.id === a.id).section, "main");
  ctx.close();
});

test("9.7.2/13.20: длительность группы — её собственное время, а не сумма содержимого", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("12:00"));
  d.toGroup(byName(d, "A").id, g.id);
  put(d, "A", "9:00", "10:00");
  assert.equal(d.duration(g), 180);
  assert.equal(d.duration(byName(d, "A")), 60);
  ctx.close();
});

// =====================================================================
//  10. Сохранение: конструктор → основной экран
// =====================================================================

test("10.2: «Сохранить» переносит Цели, «Конец», структуру и имена", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  const d = D(ctx);
  d.rename(by.A.id, "Работа");
  const g = d.createGroup("Проект").node;
  put(d, "Работа", "9:00", "13:00");
  put(d, "B", "13:00", "15:00");
  d.setTime(g.id, hm("15:00"), hm("19:00"));
  const added = d.createActivity("Спорт", hm("15:00"), hm("17:00")).node;
  assert.equal(added.parent, g.id, "вложена по времени начала");
  const more = d.createActivity("Чтение", hm("17:00"), hm("19:00")).node;
  assert.equal(more.parent, g.id);
  const res = d.commit();
  assert.equal(res.ok, true);
  assert.equal(by.A.name, "Работа", "10.5.1 имя перенесено");
  const sport = ctx.AppState.getTimers().find(t => t.name === "Спорт");
  assert.ok(sport, "создан таймер");
  near(by.A.targetProportion, 4 / 10, "Работа");
  near(by.B.targetProportion, 2 / 10, "B");
  near(sport.targetProportion, 2 / 10, "Спорт");
  near(ctx.sumTargets(), 1, "Σ Целей");
  const folder = ctx.TreeModel.allFolderNodes().find(f => f.name === "Проект");
  assert.equal(folder.children.length, 2, "вложенность перенесена (10.2.5)");
  assert.equal(ctx.document.getElementById("globalEndTime").value, "19:00", "«Конец» = конец последней (10.2.2)");
  assert.equal(ctx.document.getElementById("scheduleStart").value, "09:00");
  near(ctx.TreeModel.folderTarget(folder.id), 0.4, "Цель группы производная");
  ctx.close();
});

test("10.2.6/11.5: активность без времени становится таймером с Целью 0 и не участвует в расчётах", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  d.createActivity("Потом", null, null);
  d.createActivity("Только начало", hm("14:00"), null);
  assert.equal(d.commit().ok, true, "сохранение не блокируется");
  const later = ctx.AppState.getTimers().find(t => t.name === "Потом");
  const half = ctx.AppState.getTimers().find(t => t.name === "Только начало");
  assert.equal(later.targetProportion, 0);
  assert.equal(half.targetProportion, 0);
  near(ctx.sumTargets(), 1, "Σ Целей");
  // после повторного открытия: «Потом» в «Пустом», «Только начало» сохранила начало
  const d2 = D(ctx);
  assert.equal(d2.rows().find(r => r.node.name === "Потом").section, "empty");
  const h = byName(d2, "Только начало");
  assert.deepEqual([h.s, h.e], [hm("14:00"), null], "начало сохранилось (4.7.1)");
  ctx.close();
});

test("10.3: применяется Цель, соответствующая показанной минуте (не 0.3333)", () => {
  const { ctx, by } = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]]);
  const d = D(ctx);
  // конструктор показывает округлённые минуты: 8:00 каждое, 24 часа → 480 минут
  assert.equal(d.duration(byName(d, "A")), 480);
  put(d, "A", "9:00", "10:40");
  put(d, "B", "10:40", "12:20");
  put(d, "C", "12:20", "14:00");
  d.commit();
  near(by.A.targetProportion, 100 / 300, "A = 100 мин из 300");
  assert.ok(by.A.targetProportion === 100 / 300, "ровно минутное значение, без компенсаций");
  ctx.close();
});

test("10.4/10.6: повторное сохранение не прерывает отсчёт и накопленное время", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]], { end: "12:00" });
  ctx.TimerController.toggleTracking(by.A.id);
  ctx.clock.advanceSec(600);
  ctx.tick();
  const tracked = by.A.trackedSeconds;
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "13:00");
  assert.equal(d.commit().ok, true);
  assert.equal(by.A.isTracking, true, "отсчёт идёт");
  assert.ok(by.A.trackedSeconds >= tracked, "накопленное время сохранено");
  near(by.A.targetProportion, 0.25, "Цель A");
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.ok(by.A.trackedSeconds > tracked, "и продолжает расти");
  ctx.close();
});

test("10.4: повторное сохранение меняет Цели, состав, имена, «Начало» и «Конец»", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  let d = D(ctx);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "12:00");
  d.commit();
  d = D(ctx);
  d.rename(by.B.id, "B2");
  put(d, "A", "8:00", "9:00");
  put(d, "B2", "9:00", "10:00");
  assert.equal(d.commit().ok, true);
  near(by.A.targetProportion, 0.5, "A");
  assert.equal(by.B.name, "B2");
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.start, hm("8:00"));
  assert.equal(sched.end, hm("10:00"));
  ctx.close();
});

test("10.7: удалены все активности и группы + «Сохранить» — на основном экране нет ни таймеров, ни групп", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.B.id, f.id);
  const d = D(ctx);
  d.all().map(n => n.id).filter(id => d.get(id) && d.get(id).parent === null).forEach(id => d.remove(id));
  assert.equal(d.all().length, 0);
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.AppState.getTimers().length, 0);
  assert.equal(ctx.TreeModel.root().length, 0);
  assert.equal(ctx.container ? 0 : ctx.document.querySelectorAll(".timer-container").length, 0);
  ctx.close();
});

test("11.4.3: «Сохранить» применяет состояние окна — последнее слово за нажавшим", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "9:00", "10:00");
  put(d, "B", "10:00", "12:00");
  // пока окно открыто, «другое устройство» успело изменить и удалить
  by.A.name = "Чужое имя";
  ctx.TimerController.deleteTimer(by.B);
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.AppState.getTimers().length, 2, "удалённый B воссоздан по состоянию окна");
  assert.ok(ctx.AppState.getTimers().some(t => t.name === "B"));
  assert.equal(by.A.name, "A", "имя из окна");
  near(ctx.sumTargets(), 1, "Σ Целей");
  ctx.close();
});

// =====================================================================
//  12. Удаление
// =====================================================================

test("12.1.2/12.1.3: удаление в середине — освободившееся делится пропорционально, порядок прежний", () => {
  const { ctx } = world([["A", 0.25], ["B", 0.25], ["C", 0.5]]);
  const d = D(ctx);
  put(d, "A", "0:00", "6:00");
  put(d, "B", "6:00", "12:00");
  put(d, "C", "12:00", "24:00");
  d.remove(byName(d, "B").id);
  assert.deepEqual(span(ctx, d, "A"), ["00:00", "08:00"], "A: 6 из 18 → 8 ч");
  assert.deepEqual(span(ctx, d, "C"), ["08:00", "24:00"], "C: 12 из 18 → 16 ч");
  assert.equal(d.analyze().gapCount, 0);
  ctx.close();
});

test("12.1.4: доли внутри оставшихся групп при удалении не меняются", () => {
  const { ctx } = world([["A", 0.2], ["B", 0.2], ["C", 0.6]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("0:00"), hm("12:00"));
  put(d, "A", "0:00", "4:00");
  put(d, "B", "4:00", "12:00");
  d.toGroup(byName(d, "A").id, g.id);
  d.toGroup(byName(d, "B").id, g.id);
  put(d, "A", "0:00", "4:00");
  put(d, "B", "4:00", "12:00");
  put(d, "C", "12:00", "24:00");
  d.remove(byName(d, "C").id);
  // группа заняла все сутки, внутренние доли A:B = 1:2 прежние
  assert.deepEqual(span(ctx, d, "Группа"), ["00:00", "24:00"]);
  assert.equal(d.duration(byName(d, "A")) * 2, d.duration(byName(d, "B")));
  assert.deepEqual(errCodes(d), []);
  ctx.close();
});

test("12.3.1: удалена последняя перед промежутком — предыдущая вытягивается, промежуток не меняется", () => {
  const { ctx } = world([["A", 0.34], ["B", 0.33], ["C", 0.33]]);
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  put(d, "C", "13:00", "15:00");
  const gap = d.analyze().rootHoles[0];
  d.remove(byName(d, "C").id);
  assert.deepEqual(span(ctx, d, "B"), ["11:00", "15:00"], "вытянулась до конца удалённой");
  assert.deepEqual(span(ctx, d, "A"), ["09:00", "11:00"], "остальные не двигались");
  const after = d.analyze();
  assert.equal(after.gapCount, 1);
  near(after.rootHoles[0].len, gap.len, "размер промежутка");
  ctx.close();
});

test("12.3.2: удалена первая после промежутка — следующая сдвигается к началу прежней первой", () => {
  const { ctx } = world([["A", 0.34], ["B", 0.33], ["C", 0.33]]);
  const d = D(ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  put(d, "C", "13:00", "15:00");
  d.remove(byName(d, "A").id);
  assert.deepEqual(span(ctx, d, "B"), ["09:00", "13:00"]);
  assert.deepEqual(span(ctx, d, "C"), ["13:00", "15:00"]);
  assert.equal(d.analyze().gapCount, 1);
  ctx.close();
});

test("12.1.1/7.3.9: удаление группы — вместе с содержимым", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.toGroup(byName(d, "A").id, g.id);
  d.remove(g.id);
  assert.equal(byName(d, "A"), undefined, "A удалена вместе с группой");
  assert.ok(byName(d, "B"));
  ctx.close();
});

test("12.4: удаление внутри группы — суммарное время группы то же", () => {
  const { ctx } = world([["A", 0.25], ["B", 0.25], ["C", 0.5]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("6:00"), hm("12:00"));
  [["A", "6:00", "7:00"], ["B", "7:00", "9:00"], ["C", "9:00", "12:00"]].forEach(([n, s, e]) => {
    d.toGroup(byName(d, n).id, g.id);
    put(d, n, s, e);
  });
  assert.deepEqual(errCodes(d), []);
  d.remove(byName(d, "B").id);
  assert.deepEqual(span(ctx, d, "Группа"), ["06:00", "12:00"]);
  assert.equal(d.duration(byName(d, "A")) + d.duration(byName(d, "C")), 360);
  near(d.duration(byName(d, "A")) / d.duration(byName(d, "C")), 1 / 3, "пропорционально прежним (1:3)", 1e-2);
  assert.deepEqual(errCodes(d), []);
  ctx.close();
});

test("12.5: группа, из которой удалили/извлекли всё, не удаляется и стоит по своему началу", () => {
  const { ctx } = world([["A", 1]]);
  const d = D(ctx);
  const g = d.createGroup("Группа").node;
  d.setTime(g.id, hm("9:00"), hm("10:00"));
  d.toGroup(byName(d, "A").id, g.id);
  put(d, "A", "9:00", "10:00");
  d.remove(byName(d, "A").id);
  assert.ok(d.get(g.id), "группа осталась");
  assert.equal(d.rows().find(r => r.node.id === g.id).section, "main");
  assert.ok(errCodes(d).includes("group-empty"), "с интервалом и без содержимого — ошибка 9.4.9");
  d.setStart(g.id, null);
  assert.equal(d.rows().find(r => r.node.id === g.id).section, "empty", "без времени — в «Пустом»");
  ctx.close();
});

// =====================================================================
//  13. Инварианты — случайные сценарии
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

for (let seed = 1; seed <= Number(process.env.DD_SEEDS || 20); seed++) {
  test(`13: случайное расписание №${seed} — если сохранение разрешено, Σ Целей = 1 и раскладка совпадает с введённой`, () => {
    const rand = rng(seed * 101 + 7);
    const n = 2 + Math.floor(rand() * 4);
    const specs = Array.from({ length: n }, (_, i) => [`T${i}`, 1 / n]);
    const { ctx } = world(specs, { end: "12:00" });
    const d = D(ctx);
    // плотное расписание с одним промежутком или без него: куски по 30–300 минут
    let cur = Math.floor(rand() * 24) * 60;
    const start0 = cur;
    const durs = specs.map(() => 30 + Math.floor(rand() * 9) * 30);
    const total = durs.reduce((s, x) => s + x, 0);
    const fits = total <= 1440;
    specs.forEach(([name], i) => {
      d.setTime(byName(d, name).id, cur % 1440, ctx.ScheduleModel.normEnd(cur + durs[i]));
      cur += durs[i];
    });
    const result = d.commit();
    assert.equal(result.ok, fits, `сохранение ${fits ? "разрешено" : "заблокировано"} (Σ ${total} мин)`);
    if (!fits) return ctx.close();
    near(ctx.sumTargets(), 1, "Σ Целей");
    // повторное открытие воспроизводит введённое
    const again = D(ctx);
    let cursor = start0;
    specs.forEach(([name], i) => {
      const node = byName(again, name);
      assert.equal(node.s, cursor % 1440, `${name}: начало`);
      assert.equal(ctx.ScheduleModel.dur(node.s, node.e), durs[i], `${name}: длительность`);
      cursor += durs[i];
    });
    assert.deepEqual(errCodes(again), []);
    ctx.close();
  });
}

test("9.4.10: группа из одних элементов без времени (Цели 0 с основного экрана) не блокирует сохранение", () => {
  const { ctx, by } = world([["A", 1], ["Z", 0]]);
  const f = ctx.addFolder("Отложенное");
  ctx.moveToFolder(by.Z.id, f.id);
  const d = D(ctx);
  assert.deepEqual(errCodes(d), []);
  assert.equal(d.rows().find(r => r.node.name === "Отложенное").section, "empty");
  assert.equal(d.commit().ok, true);
  ctx.close();
});

test("первое использование: пустое приложение → создать активность → «Сохранить» → таймер с Целью 1", () => {
  const ctx = setup();
  const d = D(ctx);
  d.createActivity("Первая", hm("9:00"), hm("10:00"));
  assert.equal(d.commit().ok, true);
  const t = ctx.AppState.getTimers()[0];
  assert.equal(t.name, "Первая");
  near(t.targetProportion, 1, "Цель");
  assert.equal(ctx.document.getElementById("globalEndTime").value, "10:00");
  assert.equal(ctx.document.getElementById("scheduleStart").value, "09:00");
  assert.ok(ctx.card(t), "карточка на основном экране");
  ctx.close();
});

test("повторное «Сохранить» того, что показало окно, почти не меняет Цели (округление до минуты)", () => {
  const { ctx, by } = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]], { end: "18:00" });
  const before = [by.A, by.B, by.C].map(t => t.targetProportion);
  assert.equal(D(ctx).commit().ok, true);
  [by.A, by.B, by.C].forEach((t, i) => near(t.targetProportion, before[i], "Цель", 1 / 1440));
  near(ctx.sumTargets(), 1, "Σ Целей");
  ctx.close();
});

test("5.6/13.15: первая по времени — после промежутка, а без промежутка — та, что начинается с «Начала»", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "20:00", "23:00");
  put(d, "B", "23:00", "2:00");
  assert.equal(d.analyze().rootHoles[0].to, hm("20:00"));
  assert.deepEqual(Array.from(d.rows().map(r => r.node.name)), ["A", "B"]);
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.AppState.getSchedule().start, hm("20:00"), "«Начало» — начало первой после промежутка");
  assert.equal(ctx.AppState.getSchedule().end, hm("2:00"), "«Конец» — конец последней");
  ctx.close();
});