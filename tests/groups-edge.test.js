// Крайние случаи группировки по папкам (Требования-группы.md), найденные
// случайными сценариями (groups-fuzz.test.js) и разбором кода:
//
//   1. Принять освободившуюся часть некому: сиблинги — только пустые папки.
//      Раньше доля терялась, и сумма целей приложения падала ниже 1
//      (ТЗ 3.2.1) при правке доли, удалении таймера и удалении папки.
//   2. Единственный таймер приложения держит всю сумму (ТЗ 3.2.1).
//   3. Идентификаторы не повторяются даже в одну миллисекунду: раньше
//      Date.now() + Math.random() давал повторы, и один таймер попадал
//      в дерево дважды (ТЗ раздел 2).
//   4. «Создать задачу внутри группы» для пустой папки (ТЗ 5.3.4).
//   5. Разные мелочи отображения и операций, которые легко сломать.
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, DEFAULT_END } = require("./harness.js");

after(closeAll);

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);
const T = ctx => ctx.TreeModel;
const target = t => Number(t.targetProportion);

/** Контекст с «Концом» и набором таймеров: [{name, t}] → цели t (вес = цель). */
function world(specs) {
  const ctx = setup();
  const timers = specs.map(s =>
    ctx.addTimer({ name: s.name, proportion: s.t, targetProportion: s.t })
  );
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  const by = {};
  timers.forEach(t => (by[t.name] = t));
  return { ctx, by };
}

const shareField = (ctx, t) => ctx.shareInput(t.id);
function editShare(ctx, t, value) {
  const input = shareField(ctx, t);
  input.value = String(value);
  ctx.change(input);
}
function editTarget(ctx, t, value) {
  const input = ctx.elementOf(t.id, "target");
  input.value = String(value);
  ctx.change(input);
}

// =====================================================================
//  1. Некому принять освободившееся — сумма не теряется
// =====================================================================

test("ТЗ 3.2.1/3.8: правка доли, когда сиблинги — только пустая папка, не теряет сумму", () => {
  const { ctx, by } = world([{ name: "A", t: 1 }]);
  ctx.addFolder("Пустая");
  // A — корневая, рядом пустая папка: доля в корне не показывается, но
  // модельная правка возможна (например, из облака/скриптов)
  assert.equal(T(ctx).setShareLocal(by.A.id, 0.4), true);
  close(ctx.sumTargets(), 1, "сумма целей приложения");
  close(target(by.A), 1, "принять некому — таймер держит всё");
  ctx.close();
});

test("ТЗ 3.2.1/3.6: через поле «Доля» внутри папки с пустой подпапкой сумма папки сохраняется", () => {
  const { ctx, by } = world([
    { name: "X", t: 0.5 },
    { name: "P", t: 0.5 },
  ]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.P.id, f.id);
  const inner = T(ctx).createFolder("Пустая", f);
  ctx.TimerView.renderTree();
  assert.ok(inner);
  // в папке P и пустая подпапка: у P два сиблинга, доля показывается
  assert.equal(T(ctx).isShareVisible(by.P.id), true);
  editShare(ctx, by.P, 0.3);
  close(T(ctx).folderTarget(f.id), 0.5, "сумма папки не изменилась");
  close(ctx.sumTargets(), 1, "сумма целей приложения");
  close(T(ctx).shareOf(by.P.id), 1, "делить не с кем — P осталась с долей 1");
  ctx.close();
});

test("ТЗ 3.8: «поровну» не отдаёт долю пустой папке — делится между теми, кто может принять", () => {
  const { ctx, by } = world([
    { name: "a", t: 0 },
    { name: "b", t: 0 },
    { name: "c", t: 1 },
  ]);
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(by.a.id, f.id);
  ctx.moveToFolder(by.b.id, f.id);
  ctx.moveToFolder(by.c.id, f.id);
  T(ctx).createFolder("Пустая", f);
  ctx.TimerView.renderTree();
  // у a и b нули, c держит всё; ставим c долю 0.4 — 0.6 делится поровну
  // между a и b (пустая подпапка в делёж не входит)
  editShare(ctx, by.c, 0.4);
  close(target(by.c), 0.4, "c");
  close(target(by.a), 0.3, "a");
  close(target(by.b), 0.3, "b");
  close(ctx.sumTargets(), 1, "сумма целей приложения");
  ctx.close();
});

test("ТЗ 7.2: удаление таймера, когда рядом только пустая папка, отдаёт освободившееся выше", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.4 },
    { name: "B", t: 0.4 },
    { name: "C", t: 0.2 },
  ]);
  const outer = ctx.addFolder("Внешняя");
  ctx.moveToFolder(by.B.id, outer.id);
  T(ctx).createFolder("Пустая", outer);
  ctx.TimerView.renderTree();
  // в «Внешней» остаются B и пустая подпапка; удаляем B — группа опустела
  ctx.TimerController.deleteTimer(by.B);
  close(ctx.sumTargets(), 1, "сумма целей приложения");
  close(target(by.A) + target(by.C), 1, "всё ушло сиблингам группы");
  close(target(by.A) / target(by.C), 2, "пропорционально прежним целям (0.4 : 0.2)");
  ctx.close();
});

test("ТЗ 7.3: удаление группы, рядом с которой одна пустая папка, не теряет сумму", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.6 },
    { name: "B", t: 0.4 },
  ]);
  const f = ctx.addFolder("Моя");
  ctx.moveToFolder(by.B.id, f.id);
  const outer = ctx.addFolder("Внешняя");
  ctx.moveToFolder(f.id, outer.id);
  T(ctx).createFolder("Пустая", outer);
  ctx.TimerView.renderTree();
  const btn = ctx.folderHeader(f.id).querySelector('[data-action="delete-folder"]');
  ctx.click(btn);
  assert.equal(ctx.AppState.getTimers().length, 1, "B удалена вместе с папкой");
  close(target(by.A), 1, "A получила всё освободившееся");
  ctx.close();
});

test("ТЗ 7.2: освободившееся не достаётся пустым папкам-сиблингам", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  ctx.addFolder("Пустая 1");
  ctx.addFolder("Пустая 2");
  ctx.TimerController.deleteTimer(by.A);
  close(target(by.B), 1, "B");
  close(ctx.sumTargets(), 1, "сумма");
  ctx.close();
});

test("ТЗ 7.3: удаление единственной группы с таймерами, остальное — пустые папки", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const f = ctx.addFolder("Живая");
  ctx.moveToFolder(by.A.id, f.id);
  ctx.moveToFolder(by.B.id, f.id);
  ctx.addFolder("Пустая");
  ctx.click(ctx.folderHeader(f.id).querySelector('[data-action="delete-folder"]'));
  assert.equal(ctx.AppState.getTimers().length, 0, "таймеров не осталось");
  assert.equal(T(ctx).allFolderNodes().length, 1, "осталась только пустая папка");
  ctx.close();
});

// =====================================================================
//  2. Единственный таймер приложения
// =====================================================================

test("ТЗ 3.2.1: у единственного таймера цель остаётся 1 при любой правке цели", () => {
  const { ctx, by } = world([{ name: "Один", t: 1 }]);
  editTarget(ctx, by.Один, 0.3);
  close(target(by.Один), 1, "цель единственного таймера");
  close(ctx.sumTargets(), 1, "сумма целей");
  editTarget(ctx, by.Один, 7);
  close(target(by.Один), 1, "значение больше 1 обрезается до 1");
  ctx.close();
});

test("ТЗ 3.2.1: единственный таймер в папке тоже держит 1 (правка цели не уменьшает сумму)", () => {
  const { ctx, by } = world([{ name: "Один", t: 1 }]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.Один.id, f.id);
  editTarget(ctx, by.Один, 0.25);
  close(ctx.sumTargets(), 1, "сумма целей");
  close(T(ctx).folderTarget(f.id), 1, "цель папки");
  ctx.close();
});

test("ТЗ 3.7: при втором таймере правка цели снова нормально перераспределяет", () => {
  const { ctx, by } = world([{ name: "Один", t: 1 }]);
  const second = ctx.AppController.addNewTimer("Второй", 0.5);
  editTarget(ctx, by.Один, 0.8);
  close(target(by.Один), 0.8, "первый");
  close(target(second), 0.2, "второй");
  ctx.close();
});

// =====================================================================
//  3. Уникальность идентификаторов
// =====================================================================

test("идентификаторы не повторяются в пределах одной миллисекунды", () => {
  const { ctx } = world([{ name: "A", t: 1 }]);
  const ids = new Set();
  for (let i = 0; i < 3000; i++) ids.add(ctx.Utils.generateId());
  assert.equal(ids.size, 3000, "3000 id на замороженных часах без единого повтора");
  ctx.close();
});

test("идентификаторы папок и таймеров не пересекаются", () => {
  const { ctx, by } = world([{ name: "A", t: 1 }]);
  const seen = new Set([by.A.id]);
  for (let i = 0; i < 500; i++) {
    const id = ctx.Utils.uniqueId();
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
  ctx.close();
});

test("«Разбить» на много подзадач: у всех разные id и каждая стоит в дереве один раз", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const specs = Array.from({ length: 40 }, (_, i) => ({ name: `s${i}`, share: 1 }));
  const kids = ctx.AppController.splitTimer(by.A.id, specs, "");
  const ids = kids.map(k => k.id);
  assert.equal(new Set(ids).size, 40, "id подзадач различны");
  const inTree = ctx.flat().filter(x => x.kind === "timer").map(x => x.id);
  assert.equal(new Set(inTree).size, inTree.length, "ни один таймер не стоит в дереве дважды");
  assert.equal(inTree.length, 41, "40 подзадач и B");
  close(ctx.sumTargets(), 1, "сумма целей");
  ctx.close();
});

// =====================================================================
//  4. Создание задачи внутри пустой папки и прочие операции
// =====================================================================

test("ТЗ 5.3.4: в пустой папке сумма равна 0, поэтому новая задача получает долю от нуля", () => {
  const { ctx, by } = world([{ name: "A", t: 1 }]);
  const f = ctx.addFolder("Пустая");
  const created = ctx.AppController.createTaskInFolder(f.id, "Новая", 0.5);
  assert.ok(created);
  assert.equal(T(ctx).parentOf(created.id).id, f.id, "задача создана в папке");
  close(target(by.A), 1, "за пределами папки ничего не изменилось");
  close(ctx.sumTargets(), 1, "сумма целей приложения");
  ctx.close();
});

test("ТЗ 6: перенос в пустую папку передаёт ей цель переносимого, цель не меняется", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.7 },
    { name: "B", t: 0.3 },
  ]);
  const f = ctx.addFolder("Пустая");
  ctx.moveToFolder(by.B.id, f.id);
  close(T(ctx).folderTarget(f.id), 0.3, "цель папки = цель B");
  close(target(by.B), 0.3, "цель B не изменилась");
  close(T(ctx).shareOf(f.id), 0.3, "доля папки в корне");
  ctx.close();
});

test("ТЗ 3.2.4: у одной сущности 1 — у остальных 0, и доли папок при этом нулевые", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  editTarget(ctx, by.A, 1);
  close(target(by.A), 1, "A");
  close(target(by.B), 0, "B");
  close(target(by.C), 0, "C");
  close(T(ctx).shareOf(f.id), 0, "доля папки с нулевой суммой");
  close(T(ctx).shareOf(by.B.id), 0, "доля B при нулевой сумме уровня");
  ctx.close();
});

test("ТЗ 3.9.2: перераспределение снаружи сохраняет внутренние доли даже на глубине 3", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.4 },
    { name: "x", t: 0.3 },
    { name: "y", t: 0.2 },
    { name: "z", t: 0.1 },
  ]);
  const f1 = ctx.addFolder("1");
  const f2 = T(ctx).createFolder("2", f1);
  const f3 = T(ctx).createFolder("3", f2);
  ctx.TimerView.renderTree();
  ctx.moveToFolder(by.x.id, f3.id);
  ctx.moveToFolder(by.y.id, f3.id);
  ctx.moveToFolder(by.z.id, f2.id);
  const before = [by.x, by.y, by.z].map(t => T(ctx).shareOf(t.id));
  editTarget(ctx, by.A, 0.1); // «снаружи» для папки 1
  const after = [by.x, by.y, by.z].map(t => T(ctx).shareOf(t.id));
  before.forEach((s, i) => close(after[i], s, `доля №${i}`));
  close(T(ctx).folderTarget(f1.id), 0.9, "папка 1 вместе с содержимым выросла до 0.9");
  close(ctx.sumTargets(), 1, "сумма целей");
  ctx.close();
});

test("ТЗ 5.4: «+ Добавить таймер» при папках не меняет внутренние доли папок", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.4 },
    { name: "B", t: 0.4 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  const sharesBefore = [by.B, by.C].map(t => T(ctx).shareOf(t.id));
  const n = ctx.AppController.addNewTimer("N", 0.5);
  close(target(n), 0.5, "новая задача — в корне");
  assert.equal(T(ctx).isRootLevel(n.id), true);
  [by.B, by.C].forEach((t, i) => close(T(ctx).shareOf(t.id), sharesBefore[i], `доля ${t.name}`));
  close(T(ctx).folderTarget(f.id), 0.3, "папка ужата в (1 − p): 0.6 × 0.5");
  ctx.close();
});

test("ТЗ 8: DOM после серии операций совпадает с деревом", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.25 },
    { name: "B", t: 0.25 },
    { name: "C", t: 0.25 },
    { name: "D", t: 0.25 },
  ]);
  const f = ctx.addFolder("Ф");
  const g = T(ctx).createFolder("Г", f);
  ctx.TimerView.renderTree();
  ctx.moveToFolder(by.A.id, f.id);
  ctx.moveToFolder(by.B.id, g.id);
  ctx.click(ctx.moveButton(by.C.id, "up"));
  ctx.click(ctx.moveButton(g.id, "up"));
  ctx.click(ctx.moveButton(by.D.id, "down"));
  const dom = [];
  const walk = host =>
    Array.from(host.children).forEach(el => {
      if (el.classList.contains("folder-node")) {
        dom.push(Number(el.getAttribute("data-folder-id")));
        walk(ctx.folderChildrenEl(Number(el.getAttribute("data-folder-id"))));
      } else if (el.id.startsWith("timer-")) {
        dom.push(Number(el.id.slice(6)));
      }
    });
  walk(ctx.document.getElementById("timersContainer"));
  assert.deepEqual(dom, ctx.flat().map(x => x.id));
  ctx.close();
});
