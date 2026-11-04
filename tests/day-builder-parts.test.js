// «Конструктор дня»: Части. Если в окне дать новой активности или группе
// название уже существующей, она становится Частью основной сущности (рядом
// зелёный замок): ей можно задавать время и удалять её, а при «Сохранить» её
// время просто прибавляется к основной. Части живут только в окне — для
// планирования одного и того же дела в нескольких отрезках дня.
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
function world(specs) {
  const ctx = setup();
  const by = {};
  specs.forEach(([name, t]) => {
    by[name] = ctx.addTimer({ name, proportion: t, targetProportion: t });
  });
  return { ctx, by };
}
const D = ctx => ctx.DayDraft.fromMain();
/** Все узлы с названием, по порядку создания: [основной, часть1, часть2…]. */
const named = (d, name) =>
  d.all().filter(n => n.name === name).sort((a, b) => a.seq - b.seq);
const first = (d, name) => named(d, name)[0];
const put = (d, node, s, e) => d.setTime(node.id, hm(s), e === null ? null : hm(e));
const codes = d => Array.from(d.analyze().errors.map(e => e.code)).sort();
const sorted = set => Array.from(set).sort();
const timerOf = (ctx, name) => ctx.AppState.getTimers().find(t => t.name === name);

// =====================================================================
//  Связь по названию
// =====================================================================

test("новая активность с названием существующей — её Часть (замок), независимая — нет", () => {
  const { ctx } = world([["Йога", 0.5], ["Чтение", 0.5]]);
  const d = D(ctx);
  const part = d.createActivity("Йога", hm("18:00"), hm("19:00")).node;
  const alone = d.createActivity("Прогулка", null, null).node;
  assert.equal(d.isPart(part), true);
  assert.equal(d.mainOf(part).id, first(d, "Йога").id, "основная — существующая, не новая");
  assert.equal(d.isPart(first(d, "Йога")), false);
  assert.equal(d.isPart(alone), false);
  ctx.close();
});

test("связь не зависит от регистра и лишних пробелов", () => {
  const { ctx } = world([["Йога", 1]]);
  const d = D(ctx);
  const a = d.createActivity("  йОГа ", null, null).node;
  const b = d.createActivity("Й о г а", null, null).node;
  assert.equal(d.isPart(a), true);
  assert.equal(d.isPart(b), false, "другие слова — другое название");
  ctx.close();
});

test("две новые одноимённые: первая основная, вторая — её Часть", () => {
  const ctx = setup();
  const d = D(ctx);
  const one = d.createActivity("Зарядка", hm("7:00"), hm("7:30")).node;
  const two = d.createActivity("Зарядка", hm("12:00"), hm("12:30")).node;
  assert.equal(d.isPart(one), false);
  assert.equal(d.isPart(two), true);
  assert.equal(d.mainOf(two).id, one.id);
  ctx.close();
});

test("Частей может быть сколько угодно", () => {
  const { ctx } = world([["Йога", 1]]);
  const d = D(ctx);
  for (let i = 0; i < 12; i++) d.createActivity("йога", null, null);
  assert.equal(named(d, "Йога").length + named(d, "йога").length, 13);
  assert.equal(d.all().filter(n => d.isPart(n)).length, 12);
  ctx.close();
});

test("переименование: в одноимённую — становится Частью, в уникальное — снова самостоятельная", () => {
  const { ctx } = world([["Йога", 0.5], ["Чтение", 0.5]]);
  const d = D(ctx);
  const n = d.createActivity("Новая", null, null).node;
  assert.equal(d.isPart(n), false);
  d.rename(n.id, "чтение");
  assert.equal(d.isPart(n), true);
  assert.equal(d.mainOf(n).name, "Чтение");
  d.rename(n.id, "Другая");
  assert.equal(d.isPart(n), false);
  ctx.close();
});

test("Часть видна в окне с замком и подписью, независимая — без замка", () => {
  const { ctx } = world([["Йога", 1]]);
  ctx.DayBuilder.open();
  const draft = ctx.DayBuilder.draft;
  draft.createActivity("Йога", hm("18:00"), hm("19:00"));
  draft.createActivity("Прогулка", null, null);
  ctx.DayBuilder.render();
  const rows = Array.from(ctx.document.querySelectorAll("#ddList .dd-row"));
  const byKind = k => rows.filter(r => r.querySelector(".dd-kind").textContent === k);
  const parts = byKind("Часть активности");
  assert.equal(parts.length, 1);
  const lock = parts[0].querySelector(".dd-lock");
  assert.ok(lock, "замок");
  assert.equal(lock.textContent, "🔒");
  assert.match(lock.getAttribute("title"), /Связано с «Йога»/);
  assert.ok(parts[0].classList.contains("dd-part"));
  const plain = rows.filter(r => !r.querySelector(".dd-lock"));
  assert.equal(plain.length, 2, "основная Йога и Прогулка — без замка");
  ctx.DayBuilder.close();
  ctx.close();
});

// =====================================================================
//  Время, порядок, удаление
// =====================================================================

test("Часть встаёт в списке по своему времени между другими", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "7:00", "8:00");
  put(d, first(d, "Работа"), "9:00", "13:00");
  d.createActivity("Йога", hm("18:00"), hm("19:00"));
  d.createActivity("Йога", hm("13:00"), hm("14:00"));
  const order = Array.from(d.rows().map(r => `${r.node.name}@${ctx.ScheduleModel.fmtStart(r.node.s)}`));
  assert.deepEqual(order, ["Йога@07:00", "Работа@09:00", "Йога@13:00", "Йога@18:00"]);
  ctx.close();
});

test("Часть можно удалить — основная остаётся", () => {
  const { ctx } = world([["Йога", 1]]);
  const d = D(ctx);
  const part = d.createActivity("Йога", hm("18:00"), hm("19:00")).node;
  d.remove(part.id);
  assert.equal(d.get(part.id), null);
  assert.ok(first(d, "Йога"));
  ctx.close();
});

test("удаление основной сущности уносит все её Части", () => {
  const { ctx } = world([["Йога", 0.5], ["Чтение", 0.5]]);
  const d = D(ctx);
  d.createActivity("Йога", hm("18:00"), hm("19:00"));
  d.createActivity("Йога", hm("20:00"), hm("21:00"));
  const keep = d.createActivity("Чтение", hm("10:00"), hm("11:00")).node;
  d.remove(first(d, "Йога").id);
  assert.equal(named(d, "Йога").length, 0, "основная и обе Части удалены");
  assert.ok(d.get(keep.id), "чужая Часть не тронута");
  ctx.close();
});

test("удаление основной группы уносит Части группы и Части её содержимого (в любом месте)", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Чтение", 0.5]]);
  const f = ctx.addFolder("Утро");
  ctx.moveToFolder(by.Йога.id, f.id);
  const d = D(ctx);
  const partGroup = d.createGroup("Утро").node; // Часть группы, внутри — копия содержимого
  const standalone = d.createActivity("Йога", hm("18:00"), hm("19:00")).node; // Часть активности внутри группы
  assert.equal(d.isPart(partGroup), true);
  assert.equal(d.isPart(standalone), true);
  d.remove(first(d, "Утро").id);
  assert.equal(d.get(partGroup.id), null, "Часть группы удалена");
  assert.equal(d.get(standalone.id), null, "Часть вложенной активности удалена");
  assert.equal(named(d, "Йога").length, 0);
  assert.ok(first(d, "Чтение"), "остальное цело");
  ctx.close();
});

// =====================================================================
//  Сохранение: время Частей прибавляется к основной сущности
// =====================================================================

test("«Сохранить»: Части не создают таймеров, а добавляют время основному", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.createActivity("Йога", hm("11:00"), hm("13:00"));
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.AppState.getTimers().length, 2, "новых таймеров нет");
  near(by.Йога.targetProportion, 3 / 4, "1 ч + 2 ч Части из 4");
  near(by.Работа.targetProportion, 1 / 4, "Работа");
  near(ctx.sumTargets(), 1, "Σ целей");
  assert.equal(ctx.AppState.getSchedule().start, hm("9:00"));
  assert.equal(ctx.AppState.getSchedule().end, hm("13:00"), "«Конец» — по краю расписания, включая Часть");
  ctx.close();
});

test("много Частей разных сущностей: Цель = (своё время + Части) / всё расписание", () => {
  const { ctx, by } = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]]);
  const d = D(ctx);
  put(d, first(d, "A"), "8:00", "9:00");   // 1
  put(d, first(d, "B"), "9:00", "11:00");  // 2
  put(d, first(d, "C"), "11:00", "12:00"); // 1
  d.createActivity("A", hm("12:00"), hm("14:00")); // +2
  d.createActivity("c", hm("14:00"), hm("15:00")); // +1
  d.createActivity("a", hm("15:00"), hm("16:00")); // +1
  assert.equal(d.commit().ok, true);
  near(by.A.targetProportion, 4 / 8, "A: 1+2+1");
  near(by.B.targetProportion, 2 / 8, "B");
  near(by.C.targetProportion, 2 / 8, "C: 1+1");
  ctx.close();
});

test("основная без своего времени, но с Частью: цель берётся из Части", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Работа"), "9:00", "11:00");
  d.setStart(first(d, "Йога").id, null); // у основной времени нет
  d.createActivity("Йога", hm("11:00"), hm("12:00"));
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 1 / 3);
  near(by.Работа.targetProportion, 2 / 3);
  ctx.close();
});

test("основная в группе остаётся в своей иерархии, Часть на корне добавляет ей время", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const f = ctx.addFolder("Здоровье");
  ctx.moveToFolder(by.Йога.id, f.id);
  const d = D(ctx);
  const g = first(d, "Здоровье");
  put(d, g, "9:00", "11:00");
  put(d, first(d, "Йога"), "9:00", "11:00");
  put(d, first(d, "Работа"), "12:00", "14:00");
  const part = d.createActivity("Йога", hm("11:00"), hm("12:00")).node;
  assert.equal(part.parent, null, "в окне Часть на корне — без вложенности");
  assert.deepEqual(codes(d), [], "корневых окон: 11:00–12:00 занято Частью, дальше один промежуток");
  assert.equal(d.commit().ok, true);
  assert.equal(ctx.TreeModel.parentOf(by.Йога.id).id, f.id, "после сохранения Йога по-прежнему в «Здоровье»");
  near(by.Йога.targetProportion, 3 / 5, "Йога: 2 ч + 1 ч Части из 5");
  near(ctx.TreeModel.folderTarget(f.id), 3 / 5, "цель группы — сумма содержимого");
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("после «Сохранить» в окне одна активность на всё суммарное время — Частей уже нет", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.createActivity("Йога", hm("11:00"), hm("12:00"));
  d.commit();
  const again = D(ctx);
  assert.equal(named(again, "Йога").length, 1);
  assert.equal(again.all().filter(n => again.isPart(n)).length, 0);
  assert.equal(again.duration(first(again, "Йога")), 120, "1 ч + 1 ч");
  ctx.close();
});

test("Часть без времени ничего не добавляет и сохранению не мешает", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.createActivity("Йога", null, null);
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 0.5);
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("Части участвуют в проверках как обычные: пересечение и промежутки", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "11:00");
  put(d, first(d, "Работа"), "11:00", "12:00");
  const part = d.createActivity("Йога", hm("10:30"), hm("11:30")).node;
  assert.ok(codes(d).includes("overlap"));
  assert.equal(d.commit().ok, false);
  put(d, part, "12:00", "13:00");
  assert.deepEqual(codes(d), []);
  ctx.close();
});

// =====================================================================
//  Группы-Части
// =====================================================================

function groupWorld() {
  // Курс: Лекции, Практика (подгруппа: Задачи, Тесты)
  const { ctx, by } = world([["Лекции", 0.25], ["Задачи", 0.25], ["Тесты", 0.25], ["Отдых", 0.25]]);
  const course = ctx.addFolder("Курс");
  const practice = ctx.addFolder("Практика", ctx.TreeModel.findNode(course.id).node);
  ctx.moveToFolder(by.Лекции.id, course.id);
  ctx.moveToFolder(by.Задачи.id, practice.id);
  ctx.moveToFolder(by.Тесты.id, practice.id);
  return { ctx, by, course, practice };
}

test("группа с названием существующей — Часть группы, и внутри неё появляется всё содержимое с замками", () => {
  const { ctx } = groupWorld();
  const d = D(ctx);
  const p = d.createGroup("курс").node;
  assert.equal(d.isPart(p), true);
  const inside = d.descendants(p.id);
  assert.deepEqual(
    Array.from(inside.map(n => n.name)).sort(),
    ["Задачи", "Лекции", "Практика", "Тесты"],
    "скопировано всё: активности и вложенная группа"
  );
  assert.ok(inside.every(n => d.isPart(n)), "замок и у каждой вложенной Части активности, и у Части подгруппы");
  const nested = inside.find(n => n.name === "Задачи");
  assert.equal(d.get(nested.parent).name, "Практика");
  assert.equal(d.get(d.get(nested.parent).parent).id, p.id, "иерархия повторена");
  ctx.close();
});

test("в окне замок стоит у Части группы и у каждой вложенной Части", () => {
  const { ctx } = groupWorld();
  ctx.DayBuilder.open();
  ctx.DayBuilder.draft.createGroup("Курс");
  ctx.DayBuilder.render();
  const locked = Array.from(ctx.document.querySelectorAll("#ddList .dd-row")).filter(r => r.querySelector(".dd-lock"));
  assert.equal(locked.length, 5, "группа + Лекции + Практика + Задачи + Тесты");
  ctx.DayBuilder.close();
  ctx.close();
});

test("«Сохранить»: время содержимого Части группы прибавляется к основным активностям", () => {
  const { ctx, by } = groupWorld();
  const d = D(ctx);
  put(d, first(d, "Курс"), "9:00", "11:00");
  put(d, first(d, "Лекции"), "9:00", "11:00");
  // подгруппа и её содержимое в основной группе без времени → поставим время только на Отдых
  ["Практика", "Задачи", "Тесты"].forEach(n => d.setStart(first(d, n).id, null));
  put(d, first(d, "Отдых"), "11:00", "12:00");
  const p = d.createGroup("Курс").node;
  put(d, p, "12:00", "15:00");
  const kids = n => d.descendants(p.id).find(x => x.name === n);
  put(d, kids("Практика"), "12:00", "14:00");
  put(d, kids("Задачи"), "12:00", "13:00");
  put(d, kids("Тесты"), "13:00", "14:00");
  put(d, kids("Лекции"), "14:00", "15:00");
  assert.deepEqual(codes(d), [], "группа Части заполнена целиком: 3 часа");
  assert.equal(d.commit().ok, true);
  // всего 3 (Курс 9–12?) — считаем по активностям: Лекции 2+1, Отдых 1, Задачи 1, Тесты 1 = 6 ч
  near(by.Лекции.targetProportion, 3 / 6, "Лекции");
  near(by.Задачи.targetProportion, 1 / 6, "Задачи");
  near(by.Тесты.targetProportion, 1 / 6, "Тесты");
  near(by.Отдых.targetProportion, 1 / 6, "Отдых");
  assert.equal(ctx.TreeModel.allFolderNodes().length, 2, "новых групп не создано");
  near(ctx.sumTargets(), 1);
  ctx.close();
});

test("несвязанное содержимое Части группы переходит в основную группу при сохранении", () => {
  const { ctx, by } = groupWorld();
  const d = D(ctx);
  put(d, first(d, "Курс"), "9:00", "10:00");
  put(d, first(d, "Лекции"), "9:00", "10:00");
  ["Практика", "Задачи", "Тесты"].forEach(n => d.setStart(first(d, n).id, null));
  put(d, first(d, "Отдых"), "10:00", "11:00");
  const p = d.createGroup("Курс").node;
  put(d, p, "11:00", "13:00");
  const kids = n => d.descendants(p.id).find(x => x.name === n);
  // удаляем копии, оставляем только то, что нужно, и добавляем СВОЮ активность
  d.remove(kids("Практика").id);
  d.remove(kids("Лекции").id);
  const extra = d.createActivity("Конспект", hm("11:00"), hm("13:00")).node;
  d.toGroup(extra.id, p.id);
  assert.equal(d.isPart(extra), false);
  assert.deepEqual(codes(d), []);
  assert.equal(d.commit().ok, true);
  const added = timerOf(ctx, "Конспект");
  assert.ok(added, "Конспект создан");
  const course = ctx.TreeModel.allFolderNodes().find(f => f.name === "Курс");
  assert.equal(ctx.TreeModel.parentOf(added.id).id, course.id, "лежит в основной группе «Курс»");
  assert.equal(ctx.TreeModel.allFolderNodes().filter(f => f.name === "Курс").length, 1);
  near(added.targetProportion, 2 / 4);
  void by;
  ctx.close();
});

// =====================================================================
//  Ограничения на размещение Частей
// =====================================================================

test("Часть нельзя помещать в другую группу: красная ошибка, сохранение заблокировано", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const f = ctx.addFolder("Здоровье");
  const h = ctx.addFolder("Другая");
  ctx.moveToFolder(by.Йога.id, f.id);
  const d = D(ctx);
  put(d, first(d, "Здоровье"), "9:00", "10:00");
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "11:00", "12:00");
  put(d, first(d, "Другая"), "10:00", "11:00");
  const part = d.createActivity("Йога", hm("10:00"), hm("11:00")).node;
  d.toGroup(part.id, first(d, "Другая").id);
  assert.ok(codes(d).includes("part-parent"));
  assert.ok(d.analyze().red.has(part.id));
  const res = d.commit();
  assert.equal(res.ok, false);
  assert.match(res.errors.find(e => e.code === "part-parent").text, /нельзя помещать в другую группу или выносить/);
  d.fromGroup(part.id);
  assert.ok(!codes(d).includes("part-parent"), "вернули на корень — ошибки нет");
  void h;
  ctx.close();
});

test("Часть можно положить в группу, где лежит её основная сущность", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const f = ctx.addFolder("Здоровье");
  ctx.moveToFolder(by.Йога.id, f.id);
  const d = D(ctx);
  put(d, first(d, "Здоровье"), "9:00", "12:00");
  put(d, first(d, "Йога"), "9:00", "11:00");
  put(d, first(d, "Работа"), "12:00", "13:00");
  const part = d.createActivity("Йога", hm("11:00"), hm("12:00")).node;
  d.toGroup(part.id, first(d, "Здоровье").id);
  put(d, part, "11:00", "12:00"); // «В группу» выровняла начало по группе — ставим своё время
  assert.deepEqual(codes(d), [], "родная группа допустима и должна заполняться целиком");
  assert.equal(d.commit().ok, true);
  near(by.Йога.targetProportion, 3 / 4);
  ctx.close();
});

test("Часть, лежащую внутри Части группы, нельзя вынести из неё или переложить в другую группу", () => {
  const { ctx } = groupWorld();
  const d = D(ctx);
  const p = d.createGroup("Курс").node;
  const lect = d.descendants(p.id).find(n => n.name === "Лекции");
  put(d, lect, "9:00", "10:00"); // «В группу» доступна только для активности со временем
  d.fromGroup(lect.id);
  assert.ok(codes(d).includes("part-parent"), "вынос из группы");
  d.toGroup(lect.id, p.id);
  assert.ok(!codes(d).includes("part-parent"), "вернули — ошибки нет");
  d.toGroup(lect.id, d.descendants(p.id).find(n => n.name === "Практика").id);
  assert.ok(codes(d).includes("part-parent"), "в другую группу");
  ctx.close();
});

test("активность, ставшая Частью автоматически (по времени) в группу не вкладывается", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const f = ctx.addFolder("Блок");
  ctx.moveToFolder(by.Работа.id, f.id);
  const d = D(ctx);
  put(d, first(d, "Блок"), "9:00", "13:00");
  const part = d.createActivity("Йога", hm("10:00"), hm("11:00")).node;
  assert.equal(part.parent, null, "обычная активность с таким началом легла бы в «Блок»");
  const plain = d.createActivity("Другая", hm("10:00"), hm("11:00")).node;
  assert.equal(plain.parent, first(d, "Блок").id);
  ctx.close();
});

// =====================================================================
//  Названия в окне: пустое, занятое, разнотипное
// =====================================================================

test("пустое название сущности — ошибка при сохранении", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.rename(first(d, "Работа").id, "   ");
  assert.ok(codes(d).includes("name-empty"));
  assert.equal(d.commit().ok, false);
  d.rename(d.all().find(n => !n.name.trim()).id, "Работа");
  assert.deepEqual(codes(d), []);
  ctx.close();
});

test("существующую сущность нельзя переименовать в название другой существующей", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  d.rename(first(d, "Работа").id, "йога");
  assert.ok(codes(d).includes("name-taken"));
  assert.equal(d.commit().ok, false);
  ctx.close();
});

test("название, занятое удалённой в окне сущностью, снова свободно", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  d.remove(first(d, "Йога").id);
  d.rename(first(d, "Работа").id, "Йога");
  assert.ok(!codes(d).includes("name-taken"));
  ctx.close();
});

test("группа и активность с одним названием — ошибка (таймер можно разбить в группу)", () => {
  const { ctx } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  d.createGroup("йога");
  assert.ok(codes(d).includes("name-kind"));
  assert.equal(d.commit().ok, false);
  ctx.close();
});

test("после неудачного сохранения основной экран не изменился (Части тоже)", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const d = D(ctx);
  put(d, first(d, "Йога"), "9:00", "10:00");
  put(d, first(d, "Работа"), "10:00", "11:00");
  d.createActivity("Йога", hm("10:30"), hm("11:30")); // пересечение
  assert.equal(d.commit().ok, false);
  near(by.Йога.targetProportion, 0.5);
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

// =====================================================================
//  Окно: сквозной сценарий
// =====================================================================

function row(ctx, name, k = 0) {
  return Array.from(ctx.document.querySelectorAll("#ddList .dd-row")).filter(
    r => r.querySelector(".dd-name").value === name
  )[k];
}
const q = (ctx, s) => ctx.document.querySelector(s);

test("окно: создать одноимённую активность, задать время, «Сохранить» — Йога в двух отрезках дня", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  ctx.click(q(ctx, "#menuButton"));
  ctx.click(q(ctx, '#operationsMenu button[data-action="day-builder"]'));
  const setTime = (r, s, e) => {
    const a = r.querySelector(".dd-start");
    a.value = s;
    ctx.change(a);
  };
  const edit = (name, k, s, e) => {
    let r = row(ctx, name, k);
    r.querySelector(".dd-start").value = s;
    ctx.change(r.querySelector(".dd-start"));
    r = row(ctx, name, k);
    r.querySelector(".dd-end").value = e;
    ctx.change(r.querySelector(".dd-end"));
  };
  void setTime;
  edit("Йога", 0, "7:00", "8:00");
  edit("Работа", 0, "8:00", "17:00");
  ctx.click(q(ctx, 'button[data-dd-action="new-activity"]'));
  ctx.document.getElementById("ddNewName").value = "йога";
  ctx.document.getElementById("ddNewStart").value = "17:00";
  ctx.document.getElementById("ddNewEnd").value = "18:00";
  ctx.click(ctx.document.getElementById("ddCreateConfirm"));
  const partRow = Array.from(ctx.document.querySelectorAll("#ddList .dd-row")).find(r => r.querySelector(".dd-lock"));
  assert.ok(partRow, "у новой строки зелёный замок");
  assert.equal(partRow.querySelector(".dd-start").value, "17:00");
  ctx.click(ctx.document.getElementById("ddSave"));
  assert.equal(ctx.DayBuilder.isOpen(), false);
  near(by.Йога.targetProportion, 2 / 11, "Йога: 1 ч + 1 ч из 11");
  near(by.Работа.targetProportion, 9 / 11, "Работа: 9 ч");
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("окно: ошибка размещения Части и пустое название подсвечиваются красным", () => {
  const { ctx, by } = world([["Йога", 0.5], ["Работа", 0.5]]);
  const f = ctx.addFolder("Здоровье");
  const h = ctx.addFolder("Другая");
  ctx.moveToFolder(by.Йога.id, f.id);
  ctx.DayBuilder.open();
  const draft = ctx.DayBuilder.draft;
  const part = draft.createActivity("Йога", hm("10:00"), hm("11:00")).node;
  draft.toGroup(part.id, h.id);
  ctx.DayBuilder.render();
  assert.ok(row(ctx, "Йога", 1).classList.contains("dd-red") || Array.from(ctx.document.querySelectorAll(".dd-red")).length > 0);
  ctx.click(ctx.document.getElementById("ddSave"));
  assert.match(ctx.document.getElementById("modalError").textContent, /нельзя помещать в другую группу или выносить/);
  assert.ok(ctx.DayBuilder.isOpen());
  ctx.DayBuilder.close();
  ctx.close();
});

// =====================================================================
//  Случайные расписания с Частями: итоговые Цели считаются независимо
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

for (let seed = 1; seed <= Number(process.env.PARTS_SEEDS || 20); seed++) {
  test(`случайные Части №${seed}: Цель каждого таймера = сумма его отрезков / всё расписание`, () => {
    const rand = rng(seed * 977 + 11);
    const n = 2 + Math.floor(rand() * 4);
    const specs = Array.from({ length: n }, (_, i) => [`Дело ${i}`, 1 / n]);
    const { ctx } = world(specs);
    const d = D(ctx);
    // отрезки: каждое дело минимум раз, остальное случайно (повторы — Части)
    const segments = specs.map((s, i) => i);
    for (let k = 0; k < 2 + Math.floor(rand() * 5); k++) segments.push(Math.floor(rand() * n));
    segments.sort(() => rand() - 0.5);
    const totalsMin = new Array(n).fill(0);
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
      totalsMin[idx] += len;
      cur += len;
    }
    if (seen.size < n) return ctx.close(); // не всем хватило суток — сценарий пропускаем
    const total = totalsMin.reduce((a, b) => a + b, 0);
    const res = d.commit();
    assert.equal(res.ok, true, JSON.stringify(res.errors && res.errors.map(e => e.text)));
    specs.forEach(([name], i) => {
      near(timerOf(ctx, name).targetProportion, totalsMin[i] / total, name, 1e-9);
    });
    assert.equal(ctx.AppState.getTimers().length, n, "новых таймеров нет");
    near(ctx.sumTargets(), 1);
    ctx.close();
  });
}
