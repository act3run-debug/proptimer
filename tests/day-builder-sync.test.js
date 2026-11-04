// «Конструктор дня»: синхронизация основной экран ↔ конструктор (раздел 11),
// блокировка основного экрана (11.4), хранение, облако, экспорт/импорт
// (6.3, 6.4) и сохранение расписания между перезагрузками.
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
const hm = text => {
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
};
function world(specs, opts = {}) {
  const ctx = opts.ctx || setup();
  const by = {};
  specs.forEach(([name, target]) => {
    by[name] = ctx.addTimer({ name, proportion: target, targetProportion: target });
  });
  if (opts.end) ctx.setEndTime(opts.end);
  return { ctx, by };
}
const D = ctx => ctx.DayDraft.fromMain();
const byName = (d, name) => d.all().find(n => n.name === name);
const put = (d, name, s, e) => d.setTime(byName(d, name).id, hm(s), e === null ? null : hm(e));
const span = (ctx, d, name) => {
  const n = byName(d, name);
  const SM = ctx.ScheduleModel;
  return [n.s === null ? null : SM.fmtStart(n.s), n.e === null ? null : SM.fmtEnd(n.e)];
};
const section = (d, name) => d.rows().find(r => r.node.name === name).section;
const editTarget = (ctx, timer, value) => {
  const input = ctx.elementOf(timer.id, "target");
  input.value = String(value);
  ctx.change(input);
};

/** Сохранённое расписание с промежутком: A 9–11, B 11–13, C 13–15. */
function gapped() {
  const w = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]], { end: "12:00" });
  const d = D(w.ctx);
  put(d, "A", "9:00", "11:00");
  put(d, "B", "11:00", "13:00");
  put(d, "C", "13:00", "15:00");
  assert.equal(d.commit().ok, true);
  return w;
}

// =====================================================================
//  11. Основной экран → конструктор
// =====================================================================

test("11.2: изменение Цели меняет длительность; порядок, «Начало» и «Конец» сохраняются", () => {
  const { ctx, by } = gapped();
  editTarget(ctx, by.B, 0.5); // B больше, остальные в одно и то же число раз меньше
  const d = D(ctx);
  // расписание 9:00–15:00 (360 мин): A 0.25, B 0.5, C 0.25
  assert.deepEqual(span(ctx, d, "A"), ["09:00", "10:30"]);
  assert.deepEqual(span(ctx, d, "B"), ["10:30", "13:30"]);
  assert.deepEqual(span(ctx, d, "C"), ["13:30", "15:00"]);
  assert.equal(ctx.AppState.getSchedule().start, hm("9:00"));
  assert.equal(ctx.AppState.getSchedule().end, hm("15:00"));
  ctx.close();
});

test("11.2: правка Доли внутри группы на основном экране отражается во времени", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.25], ["C", 0.25]], { end: "00:00" });
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  let d = D(ctx);
  assert.equal(d.duration(byName(d, "B")), 360);
  const share = ctx.shareInput(by.B.id);
  share.value = "0.75";
  ctx.change(share);
  d = D(ctx);
  assert.equal(d.duration(byName(d, "B")), 540, "B: 0.75 от 12 ч группы");
  assert.equal(d.duration(byName(d, "C")), 180);
  assert.equal(d.duration(byName(d, "Группа")), 720, "время группы то же");
  assert.deepEqual(Array.from(d.analyze().errors), []);
  ctx.close();
});

test("11.3.1/11.3.4: новый таймер получает время автоматически, остальные сжимаются", () => {
  const { ctx, by } = gapped();
  const fresh = ctx.AppController.addNewTimer("Новый", 0.5);
  const d = D(ctx);
  assert.equal(ctx.AppState.getSchedule().start, hm("9:00"));
  assert.equal(ctx.AppState.getSchedule().end, hm("15:00"), "11.3.3: «Начало» и «Конец» те же");
  assert.equal(d.duration(byName(d, "Новый")), 180, "половина расписания");
  assert.equal(d.duration(byName(d, "A")), 60, "остальные ужались вдвое");
  near(fresh.targetProportion + by.A.targetProportion + by.B.targetProportion + by.C.targetProportion, 1, "Σ");
  ctx.close();
});

test("11.3.5: при промежутке новая активность — последняя, непосредственно перед промежутком", () => {
  const { ctx } = gapped();
  ctx.AppController.addNewTimer("Новый", 0.25);
  const d = D(ctx);
  const n = byName(d, "Новый");
  assert.equal(n.e, hm("15:00"), "заканчивается там, где раньше заканчивалась последняя");
  assert.deepEqual(span(ctx, d, "A"), ["09:00", "10:30"], "остальные идут от «Начала» в прежнем порядке");
  assert.equal(
    Array.from(d.rows().map(r => r.node.name)).pop(),
    "Новый",
    "в конце основного списка"
  );
  assert.equal(d.analyze().gapCount, 1);
  ctx.close();
});

test("11.3.5/11.3.6: без промежутка новая активность делит сутки; пример 00:00–24:00 + доля 0,5", () => {
  const { ctx, by } = world([["Первая", 1]]);
  let d = D(ctx);
  assert.deepEqual(span(ctx, d, "Первая"), ["00:00", "24:00"], "Цель 1 — весь день");
  assert.equal(d.commit().ok, true);
  ctx.AppController.addNewTimer("Вторая", 0.5);
  near(by.Первая.targetProportion, 0.5, "Цель первой стала 0,5");
  d = D(ctx);
  assert.deepEqual(span(ctx, d, "Первая"), ["00:00", "12:00"]);
  assert.deepEqual(span(ctx, d, "Вторая"), ["12:00", "24:00"]);
  assert.equal(ctx.AppState.getSchedule().end, 0, "«Конец» не меняется (11.3.5)");
  ctx.close();
});

test("11.3.2/11.5: таймер с Целью 0 остаётся без времени и попадает в «Пустое»", () => {
  const { ctx } = gapped();
  ctx.AppController.addNewTimer("Нулевой", 0);
  const d = D(ctx);
  const n = byName(d, "Нулевой");
  assert.deepEqual([n.s, n.e], [null, null]);
  assert.equal(section(d, "Нулевой"), "empty");
  assert.equal(d.analyze().errors.length, 0);
  ctx.close();
});

test("11.5: Цель стала 0 на основном экране — время пропадает целиком (и начало, и конец)", () => {
  const { ctx, by } = gapped();
  const d0 = D(ctx);
  d0.setEnd(byName(d0, "A").id, null); // у A в черновике только начало — но сохранять не будем
  editTarget(ctx, by.B, 0);
  const d = D(ctx);
  const b = byName(d, "B");
  assert.deepEqual([b.s, b.e], [null, null]);
  assert.equal(section(d, "B"), "empty");
  // остальные заняли расписание целиком, «Начало» и «Конец» те же
  assert.equal(d.duration(byName(d, "A")) + d.duration(byName(d, "C")), 360);
  assert.equal(ctx.AppState.getSchedule().end, hm("15:00"));
  ctx.close();
});

test("11.5: обнулённая активность не растягивается до минуты; при новой Цели встаёт последней", () => {
  const { ctx, by } = gapped();
  editTarget(ctx, by.A, 0);
  editTarget(ctx, by.A, 0.2);
  const d = D(ctx);
  assert.equal(
    byName(d, "A").e,
    hm("15:00"),
    "активность, получившая Цель, встала последней — перед промежутком"
  );
  ctx.close();
});

test("12.2: удаление на основном экране — освободившееся время по Целям, «Начало»/«Конец» не меняются", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.25], ["C", 0.25]], { end: "12:00" });
  const d0 = D(ctx);
  put(d0, "A", "8:00", "12:00");
  put(d0, "B", "12:00", "14:00");
  put(d0, "C", "14:00", "16:00");
  d0.commit();
  ctx.TimerController.deleteTimer(by.B);
  const d = D(ctx);
  assert.deepEqual(span(ctx, d, "A"), ["08:00", "13:20"], "A: 4 из 6 → 5 ч 20 м");
  assert.deepEqual(span(ctx, d, "C"), ["13:20", "16:00"]);
  assert.equal(ctx.AppState.getSchedule().start, hm("8:00"));
  assert.equal(ctx.AppState.getSchedule().end, hm("16:00"));
  ctx.close();
});

test("12.2/12.3: удаление крайней на основном экране тоже не двигает «Начало» и «Конец»", () => {
  const { ctx, by } = gapped();
  ctx.TimerController.deleteTimer(by.C);
  const sched = ctx.AppState.getSchedule();
  assert.equal(sched.start, hm("9:00"));
  assert.equal(sched.end, hm("15:00"));
  const d = D(ctx);
  assert.equal(d.duration(byName(d, "A")) + d.duration(byName(d, "B")), 360, "расписание заполнено без дыр");
  assert.equal(d.analyze().gapCount, 1);
  ctx.close();
});

test("10.5.2: переименование на основном экране видно в конструкторе (таймер и группа)", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Старая");
  ctx.moveToFolder(by.B.id, f.id);
  const nameInput = ctx.card(by.A).querySelector('input[data-action="name"]');
  nameInput.value = "Новое имя";
  ctx.change(nameInput);
  const folderName = ctx.document.getElementById(`folder-name-${f.id}`);
  folderName.value = "Новая группа";
  ctx.change(folderName);
  const d = D(ctx);
  assert.ok(byName(d, "Новое имя"));
  assert.ok(byName(d, "Новая группа"));
  assert.equal(byName(d, "Старая"), undefined);
  ctx.close();
});

test("8.6: вложенность общая — перенос «В группу» на основном экране виден в конструкторе, и наоборот", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(by.B.id, f.id);
  let d = D(ctx);
  assert.equal(byName(d, "B").parent, f.id);
  // в конструкторе вынимаем B и кладём A в группу
  d.fromGroup(byName(d, "B").id);
  const g = byName(d, "Группа");
  d.setTime(g.id, hm("0:00"), hm("12:00"));
  d.toGroup(byName(d, "A").id, g.id);
  put(d, "A", "0:00", "12:00");
  put(d, "B", "12:00", "24:00");
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.TreeModel.parentOf(by.A.id).id, f.id, "A теперь в группе на основном экране");
  assert.equal(ctx.TreeModel.parentOf(by.B.id), null, "B вынута");
  ctx.close();
});

test("«Разбить» на основном экране: папка занимает место таймера, время делится по долям", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]], { end: "00:00" });
  const d0 = D(ctx);
  put(d0, "A", "0:00", "12:00");
  put(d0, "B", "12:00", "24:00");
  d0.commit();
  ctx.AppController.splitTimer(
    by.A.id,
    [{ name: "A1", share: 1 }, { name: "A2", share: 3 }],
    ""
  );
  const d = D(ctx);
  assert.deepEqual(span(ctx, d, "A"), ["00:00", "12:00"], "папка «A» на месте исходного таймера");
  assert.deepEqual(span(ctx, d, "A1"), ["00:00", "03:00"]);
  assert.deepEqual(span(ctx, d, "A2"), ["03:00", "12:00"]);
  assert.deepEqual(span(ctx, d, "B"), ["12:00", "24:00"]);
  ctx.close();
});

test("11.1: закрытое окно меняется сразу — следующее открытие показывает свежее состояние", () => {
  const { ctx, by } = gapped();
  ctx.DayBuilder.open();
  ctx.DayBuilder.close();
  editTarget(ctx, by.A, 0.6);
  ctx.DayBuilder.open();
  const rows = Array.from(ctx.document.querySelectorAll("#ddList .dd-row .dd-duration")).map(e => e.textContent);
  assert.match(rows[0], /Длительность: 3ч 36м/, "A: 0.6 от 6 ч");
  ctx.DayBuilder.close();
  ctx.close();
});

// =====================================================================
//  11.4. Блокировка основного экрана и изоляция окна
// =====================================================================

test("11.4.1: пока окно открыто, основной экран не редактируется", () => {
  const { ctx, by } = gapped();
  ctx.DayBuilder.open();
  const targets = [by.A, by.B, by.C].map(t => t.targetProportion);
  // клик «Удалить» на карточке и правка Цели игнорируются
  ctx.click(ctx.card(by.A).querySelector('button[data-action="delete"]'));
  editTarget(ctx, by.B, 0.9);
  ctx.click(ctx.card(by.C).querySelector('button[data-action="track"]'));
  const addButton = ctx.document.querySelector('#globalControls button[data-action="add-timer"]');
  ctx.click(addButton);
  assert.equal(ctx.AppState.getTimers().length, 3, "ничего не удалилось");
  assert.equal(by.C.isTracking, false, "старт не сработал");
  assert.deepEqual([by.A, by.B, by.C].map(t => t.targetProportion), targets);
  assert.equal(ctx.document.getElementById("addTaskName"), null, "окно «Добавить таймер» не открылось");
  ctx.DayBuilder.close();
  ctx.close();
});

test("11.4.2: изменения с других устройств не принимаются, пока окно открыто", () => {
  const { ctx } = gapped();
  assert.equal(ctx.CloudSync.canAutoApply(), true, "без окна приём разрешён");
  ctx.DayBuilder.open();
  assert.equal(ctx.CloudSync.canAutoApply(), false, "с окном — нет");
  ctx.DayBuilder.close();
  assert.equal(ctx.CloudSync.canAutoApply(), true);
  ctx.close();
});

test("11.4.2: окно — снимок: правки основного экрана «со стороны» в открытое окно не попадают", () => {
  const { ctx, by } = gapped();
  ctx.DayBuilder.open();
  const before = ctx.DayBuilder.draft.duration(ctx.DayBuilder.draft.get(by.A.id));
  by.A.targetProportion = 0.9; // «пришло с другого устройства»
  by.B.name = "Переименована";
  assert.equal(ctx.DayBuilder.draft.duration(ctx.DayBuilder.draft.get(by.A.id)), before);
  assert.equal(ctx.DayBuilder.draft.get(by.B.id).name, "B");
  ctx.DayBuilder.close();
  ctx.close();
});

// =====================================================================
//  Хранение, облако, экспорт и импорт
// =====================================================================

test("6.3: ключ «schedule» входит в STATE_KEYS и в осмысленную проекцию облака", () => {
  const { ctx, by } = gapped();
  assert.ok(Array.from(ctx.CloudSync.STATE_KEYS).includes("schedule"));
  ctx.StorageService.saveToLocalStorage();
  const snap = ctx.CloudSync.snapshotLocal();
  assert.ok(snap.schedule, "расписание в снимке");
  const base = ctx.CloudSync.meaningfulProjection(snap);
  // тот же состав, другой порядок по времени → другая проекция
  const copy = JSON.parse(snap.schedule);
  copy.order.root = copy.order.root.slice().reverse();
  assert.notEqual(ctx.CloudSync.meaningfulProjection({ ...snap, schedule: JSON.stringify(copy) }), base);
  void by;
  ctx.close();
});

test("6.3: расписание переживает перезагрузку и принимается «вторым устройством»", () => {
  const { ctx } = gapped();
  ctx.StorageService.saveToLocalStorage();
  const keys = ["timers", "tree", "schedule", "globalEndTimeValue", "lastSessionEndTime"];
  const dump = {};
  keys.forEach(k => (dump[k] = ctx.window.localStorage.getItem(k)));
  const other = setup();
  keys.forEach(k => dump[k] !== null && other.window.localStorage.setItem(k, dump[k]));
  other.StorageService.loadTimersFromLocalStorage();
  const sched = other.AppState.getSchedule();
  assert.equal(sched.saved, true);
  assert.equal(sched.start, hm("9:00"));
  assert.equal(sched.end, hm("15:00"));
  const d = D(other);
  assert.deepEqual(span(other, d, "A"), ["09:00", "11:00"]);
  assert.deepEqual(span(other, d, "C"), ["13:00", "15:00"]);
  other.close();
  ctx.close();
});

test("6.3: «Начало» после загрузки показано в поле на основном экране", () => {
  const { ctx } = gapped();
  ctx.StorageService.saveToLocalStorage();
  const other = setup();
  ["timers", "tree", "schedule", "globalEndTimeValue", "lastSessionEndTime"].forEach(k => {
    const v = ctx.window.localStorage.getItem(k);
    if (v !== null) other.window.localStorage.setItem(k, v);
  });
  other.StorageService.loadTimersFromLocalStorage();
  other.ScheduleModel.renderStartField();
  assert.equal(other.document.getElementById("scheduleStart").value, "09:00");
  assert.equal(other.document.getElementById("globalEndTime").value, "15:00");
  other.close();
  ctx.close();
});

test("6.3: битое расписание в хранилище не ломает приложение", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  ctx.StorageService.saveToLocalStorage();
  const other = setup();
  ["timers", "tree"].forEach(k => other.window.localStorage.setItem(k, ctx.window.localStorage.getItem(k)));
  other.window.localStorage.setItem("schedule", "{не json");
  other.StorageService.loadTimersFromLocalStorage();
  assert.equal(other.AppState.getTimers().length, 2);
  assert.equal(other.AppState.getSchedule().saved, false);
  assert.doesNotThrow(() => D(other));
  other.close();
  ctx.close();
});

test("6.4: расписание входит в экспорт и восстанавливается при импорте", () => {
  const { ctx } = gapped();
  let exported = "";
  ctx.window.Blob = function (parts) {
    exported = parts.join("");
  };
  ctx.window.URL.createObjectURL = () => "blob:test";
  ctx.window.URL.revokeObjectURL = () => {};
  ctx.StorageService.exportTimersToFile();
  const payload = JSON.parse(exported);
  assert.equal(payload.schedule.saved, true);
  assert.equal(payload.schedule.start, hm("9:00"));
  assert.equal(payload.schedule.order.root.length, 3);

  const other = setup();
  const real = other.document.createElement.bind(other.document);
  let fileInput = null;
  other.document.createElement = tag => {
    const el = real(tag);
    if (tag === "input") fileInput = el;
    return el;
  };
  other.window.FileReader = class {
    readAsText() {
      this.onload({ target: { result: exported } });
    }
  };
  other.StorageService.importTimersFromFile();
  fileInput.onchange({ target: { files: [{}] } });
  const sched = other.AppState.getSchedule();
  assert.equal(sched.saved, true);
  assert.equal(sched.start, hm("9:00"));
  assert.equal(sched.end, hm("15:00"));
  assert.equal(other.document.getElementById("scheduleStart").value, "09:00");
  assert.equal(other.document.getElementById("globalEndTime").value, "15:00");
  const d = D(other);
  assert.deepEqual(span(other, d, "B"), ["11:00", "13:00"]);
  other.close();
  ctx.close();
});

test("6.4: старый экспорт без расписания импортируется — расписание по умолчанию", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  let exported = "";
  ctx.window.Blob = function (parts) {
    exported = parts.join("");
  };
  ctx.window.URL.createObjectURL = () => "blob:test";
  ctx.window.URL.revokeObjectURL = () => {};
  ctx.StorageService.exportTimersToFile();
  const payload = JSON.parse(exported);
  delete payload.schedule;
  const other = setup();
  const real = other.document.createElement.bind(other.document);
  let fileInput = null;
  other.document.createElement = tag => {
    const el = real(tag);
    if (tag === "input") fileInput = el;
    return el;
  };
  other.window.FileReader = class {
    readAsText() {
      this.onload({ target: { result: JSON.stringify(payload) } });
    }
  };
  other.StorageService.importTimersFromFile();
  fileInput.onchange({ target: { files: [{}] } });
  assert.equal(other.AppState.getTimers().length, 2);
  assert.equal(other.AppState.getSchedule().saved, false);
  other.close();
  ctx.close();
});

test("порядок по времени переживает перезагрузку (А после Б во времени, но раньше на основном экране)", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const d = D(ctx);
  put(d, "A", "12:00", "14:00");
  put(d, "B", "10:00", "12:00");
  d.commit();
  ctx.StorageService.saveToLocalStorage();
  const other = setup();
  ["timers", "tree", "schedule", "globalEndTimeValue", "lastSessionEndTime"].forEach(k => {
    const v = ctx.window.localStorage.getItem(k);
    if (v !== null) other.window.localStorage.setItem(k, v);
  });
  other.StorageService.loadTimersFromLocalStorage();
  const names = Array.from(D(other).rows().map(r => r.node.name));
  assert.deepEqual(names, ["B", "A"]);
  assert.equal(other.TreeModel.root()[0].id, by.A.id, "на основном экране порядок прежний");
  other.close();
  ctx.close();
});

// =====================================================================
//  Регрессия: механики основного экрана, которые «Конструктор» не меняет (1.4)
// =====================================================================

test("1.4: пока конструктором не пользовались, «Конец» принимает любое время без прилипания", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  ctx.setEndTime("14:54");
  ctx.ScheduleModel.onEndFieldCommitted();
  assert.equal(ctx.document.getElementById("globalEndTime").value, "14:54");
  assert.equal(ctx.AppState.getSchedule().saved, false);
  ctx.close();
});

test("1.4: открытие и «Закрыть» конструктора ничего не меняют на основном экране (6.5)", () => {
  const { ctx, by } = gapped();
  const snapshot = () =>
    JSON.stringify({
      timers: ctx.AppState.getTimers().map(t => [t.id, t.name, t.targetProportion, t.proportion]),
      tree: ctx.AppState.getTree(),
      schedule: ctx.AppState.getSchedule(),
      end: ctx.document.getElementById("globalEndTime").value,
    });
  const before = snapshot();
  ctx.DayBuilder.open();
  ctx.DayBuilder.draft.rename(by.A.id, "Черновик");
  ctx.DayBuilder.draft.remove(by.B.id);
  ctx.DayBuilder.draft.createActivity("Новая", hm("1:00"), hm("2:00"));
  ctx.DayBuilder.close();
  assert.equal(snapshot(), before, "«Закрыть» откатывает всё к сохранённому");
  ctx.close();
});
