// Сквозные UI-сценарии группировки по папкам: всё делается настоящими
// кликами и вводом в поля (делегирование событий, модальные окна), как это
// делает пользователь, — а не вызовами внутренних методов.
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
  return { ctx, by, document: ctx.document };
}

const q = (ctx, sel) => ctx.document.querySelector(sel);
const qa = (ctx, sel) => Array.from(ctx.document.querySelectorAll(sel));
const modalOpen = ctx =>
  !ctx.document.getElementById("modalOverlay").classList.contains("hidden");
const byId = (ctx, id) => ctx.document.getElementById(id);

/** Открыть пункт «Операций» (кнопка меню → пункт). */
function openOperation(ctx, action) {
  ctx.click(q(ctx, "#menuButton"));
  ctx.click(q(ctx, `#operationsMenu button[data-action="${action}"]`));
  assert.equal(modalOpen(ctx), true, `модалка «${action}» открылась`);
}
const cardButton = (ctx, node, action) => {
  const id = node.id;
  const isFolder = T(ctx).isFolder(T(ctx).findNode(id).node);
  const host = isFolder ? ctx.folderHeader(id) : ctx.card(id);
  return host.querySelector(`button[data-action="${action}"]`);
};

// =====================================================================
//  «Создать группу»
// =====================================================================

test("UI: «Создать группу» — название по умолчанию, пустое название заменяется умолчанием", () => {
  const { ctx } = world([{ name: "A", t: 1 }]);
  openOperation(ctx, "create-group");
  assert.equal(byId(ctx, "createGroupName").value, "Группа", "название предложено");
  byId(ctx, "createGroupName").value = "   ";
  ctx.click(byId(ctx, "createGroupConfirm"));
  assert.equal(modalOpen(ctx), false, "модалка закрыта");
  const folders = T(ctx).allFolderNodes();
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, "Группа", "пустое название заменено умолчанием");
  ctx.close();
});

test("UI: «Отмена» в «Создать группу» ничего не создаёт", () => {
  const { ctx } = world([{ name: "A", t: 1 }]);
  openOperation(ctx, "create-group");
  ctx.click(byId(ctx, "modalCancel"));
  assert.equal(modalOpen(ctx), false);
  assert.equal(T(ctx).allFolderNodes().length, 0);
  ctx.close();
});

test("UI: пустая группа не ломает ни планы, ни тик, ни рекомендации", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  openOperation(ctx, "create-group");
  ctx.click(byId(ctx, "createGroupConfirm"));
  ctx.TimerController.toggleTracking(by.A.id);
  ctx.clock.advanceSec(120);
  ctx.tick();
  ctx.AppController.calculateRecommendations();
  assert.ok(by.A.trackedSeconds > 100);
  assert.doesNotMatch(ctx.document.getElementById("timersContainer").textContent, /NaN|Infinity/);
  ctx.close();
});

// =====================================================================
//  «Разбить»
// =====================================================================

function openSplit(ctx, timer) {
  ctx.click(cardButton(ctx, timer, "split"));
  assert.equal(modalOpen(ctx), true, "модалка разбиения открылась");
}
function fillSplit(ctx, rows) {
  const holders = qa(ctx, "#splitRows .split-row");
  rows.forEach(([name, share], i) => {
    holders[i].querySelector(".split-name").value = name;
    holders[i].querySelector(".split-share").value = share;
  });
}

test("UI: «Разбить» — по умолчанию папка названа как исходный таймер", () => {
  const { ctx, by } = world([
    { name: "Чтение", t: 0.6 },
    { name: "B", t: 0.4 },
  ]);
  openSplit(ctx, by.Чтение);
  assert.equal(byId(ctx, "splitFolderName").value, "Чтение");
  fillSplit(ctx, [["Книга", "1/4"], ["Статьи", "3/4"]]);
  ctx.click(byId(ctx, "splitConfirm"));
  const folder = T(ctx).allFolderNodes()[0];
  assert.equal(folder.name, "Чтение");
  assert.equal(ctx.AppState.findTimerById(by.Чтение.id), undefined, "исходного таймера больше нет");
  assert.equal(ctx.cardById(by.Чтение.id), null, "его карточка убрана из DOM");
  const kids = folder.children.map(n => ctx.AppState.findTimerById(n.id));
  close(target(kids[0]), 0.15, "«Книга»: 0.6 × 1/4");
  close(target(kids[1]), 0.45, "«Статьи»: 0.6 × 3/4");
  close(T(ctx).shareOf(kids[0].id), 0.25, "доли в новой папке = доли разбиения");
  close(T(ctx).shareOf(kids[1].id), 0.75, "доли в новой папке = доли разбиения");
  close(ctx.sumTargets(), 1, "сумма целей");
  ctx.close();
});

test("UI: «Разбить» — своё название папки; пустое возвращает имя таймера", () => {
  const { ctx, by } = world([
    { name: "Работа", t: 0.5 },
    { name: "Дом", t: 0.5 },
  ]);
  openSplit(ctx, by.Работа);
  byId(ctx, "splitFolderName").value = "Проекты";
  fillSplit(ctx, [["P1", "1"], ["P2", "1"]]);
  ctx.click(byId(ctx, "splitConfirm"));
  assert.equal(T(ctx).allFolderNodes()[0].name, "Проекты");

  openSplit(ctx, by.Дом);
  byId(ctx, "splitFolderName").value = "";
  fillSplit(ctx, [["D1", "2"], ["D2", "1"]]);
  ctx.click(byId(ctx, "splitConfirm"));
  const names = Array.from(T(ctx).allFolderNodes()).map(f => f.name);
  assert.deepEqual(names.sort(), ["Дом", "Проекты"]);
  ctx.close();
});

test("UI: «Разбить» таймер, уже лежащий в папке, оставляет подпапку на его месте", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  const outer = ctx.addFolder("Внешняя");
  ctx.moveToFolder(by.B.id, outer.id);
  ctx.moveToFolder(by.C.id, outer.id);
  openSplit(ctx, by.B);
  fillSplit(ctx, [["B1", "1"], ["B2", "1"]]);
  ctx.click(byId(ctx, "splitConfirm"));
  const inner = outer.children[0];
  assert.equal(T(ctx).isFolder(inner), true, "на месте B теперь подпапка");
  assert.equal(inner.name, "B");
  assert.equal(inner.children.length, 2);
  close(T(ctx).folderTarget(outer.id), 0.5, "сумма внешней папки не изменилась");
  close(target(by.A), 0.5, "корень не тронут");
  ctx.close();
});

test("UI: ошибка в «Разбить» (одна подзадача) оставляет окно открытым и ничего не меняет", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  openSplit(ctx, by.A);
  const rows = qa(ctx, "#splitRows .split-row");
  rows[1].remove();
  rows[0].querySelector(".split-name").value = "Только одна";
  ctx.click(byId(ctx, "splitConfirm"));
  assert.equal(modalOpen(ctx), true, "окно осталось открытым");
  assert.match(byId(ctx, "modalError").textContent, /минимум две/);
  assert.equal(T(ctx).allFolderNodes().length, 0);
  assert.ok(ctx.AppState.findTimerById(by.A.id));
  ctx.close();
});

// =====================================================================
//  «Создать задачу внутри группы»
// =====================================================================

test("UI: «Создать задачу внутри группы» с папкой — доля вводится дробью и считается внутри папки", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  openOperation(ctx, "create-in-group");
  const boxes = qa(ctx, ".group-checkbox");
  assert.equal(boxes.length, 1, "в списке только существующие папки");
  assert.equal(boxes[0].getAttribute("data-folder-id"), String(f.id));
  boxes[0].checked = true;
  byId(ctx, "groupTaskName").value = "Новая";
  byId(ctx, "groupTaskProportion").value = "1/4";
  ctx.click(byId(ctx, "groupTaskConfirm"));
  const created = ctx.AppState.getTimers().find(t => t.name === "Новая");
  assert.ok(created);
  assert.equal(T(ctx).parentOf(created.id).id, f.id);
  close(T(ctx).folderTarget(f.id), 0.5, "сумма папки не изменилась");
  close(T(ctx).shareOf(created.id), 0.25, "доля новой задачи внутри папки");
  close(target(by.A), 0.5, "за пределами папки ничего не меняется");
  close(ctx.sumTargets(), 1, "сумма целей");
  ctx.close();
});

test("UI: «Создать задачу внутри группы» без отметки — ошибка, окно открыто", () => {
  const { ctx } = world([{ name: "A", t: 1 }]);
  openOperation(ctx, "create-in-group");
  byId(ctx, "groupTaskName").value = "X";
  ctx.click(byId(ctx, "groupTaskConfirm"));
  assert.equal(modalOpen(ctx), true);
  assert.match(byId(ctx, "modalError").textContent, /Отметьте/);
  assert.equal(ctx.AppState.getTimers().length, 1);
  ctx.close();
});

test("UI: «Создать задачу внутри группы» — некорректная доля не создаёт задачу", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  for (const bad of ["abc", "-0.1", "1", "2"]) {
    openOperation(ctx, "create-in-group");
    qa(ctx, ".group-checkbox")[0].checked = true;
    byId(ctx, "groupTaskName").value = "Z";
    byId(ctx, "groupTaskProportion").value = bad;
    ctx.click(byId(ctx, "groupTaskConfirm"));
    assert.equal(modalOpen(ctx), true, `«${bad}» отклонено`);
    ctx.click(byId(ctx, "modalCancel"));
  }
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("UI: без папок «Создать задачу внутри группы» предлагает таймеры и создаёт из них папку", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  openOperation(ctx, "create-in-group");
  const boxes = qa(ctx, ".group-checkbox");
  assert.equal(boxes.length, 3, "предложены таймеры");
  boxes.forEach(b => assert.ok(b.classList.contains("group-timer")));
  boxes[1].checked = true; // B
  boxes[2].checked = true; // C
  byId(ctx, "groupTaskFolderName").value = "Остальное";
  byId(ctx, "groupTaskName").value = "D";
  byId(ctx, "groupTaskProportion").value = "0.5";
  ctx.click(byId(ctx, "groupTaskConfirm"));
  const folder = T(ctx).allFolderNodes()[0];
  assert.equal(folder.name, "Остальное");
  assert.equal(folder.children.length, 3, "B, C и новая D");
  close(T(ctx).folderTarget(folder.id), 0.5, "папка сохранила сумму B + C");
  close(target(by.A), 0.5, "A не тронута");
  ctx.close();
});

// =====================================================================
//  «В группу»
// =====================================================================

test("UI: «В группу» у таймера — в списке нет лишнего, перенос не меняет цель", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  const g = ctx.addFolder("Г");
  ctx.moveToFolder(by.C.id, g.id);
  ctx.click(cardButton(ctx, by.B, "to-group"));
  assert.equal(modalOpen(ctx), true);
  const folderBoxes = qa(ctx, ".move-folder");
  assert.equal(folderBoxes.length, 2, "обе папки доступны");
  assert.equal(qa(ctx, ".move-root").length, 1, "есть вариант «вне группы»");
  folderBoxes.find(b => b.getAttribute("data-folder-id") === String(f.id)).checked = true;
  ctx.click(byId(ctx, "moveConfirm"));
  assert.equal(T(ctx).parentOf(by.B.id).id, f.id);
  close(target(by.B), 0.3, "цель не изменилась");
  close(T(ctx).folderTarget(f.id), 0.3);
  close(T(ctx).folderTarget(g.id), 0.2);
  close(ctx.sumTargets(), 1);
  ctx.close();
});

test("UI: «В группу» у папки не предлагает её саму и её потомков", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const outer = ctx.addFolder("Внешняя");
  const inner = T(ctx).createFolder("Внутренняя", outer);
  ctx.TimerView.renderTree();
  const other = ctx.addFolder("Чужая");
  ctx.moveToFolder(by.A.id, inner.id);
  ctx.click(cardButton(ctx, outer, "to-group"));
  const offered = qa(ctx, ".move-folder").map(b => Number(b.getAttribute("data-folder-id")));
  assert.deepEqual(offered, [other.id], "только посторонняя папка");
  ctx.click(byId(ctx, "modalCancel"));
  ctx.close();
});

test("UI: «В группу» → «вне группы» выносит таймер в корень", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.click(cardButton(ctx, by.B, "to-group"));
  qa(ctx, ".move-root")[0].checked = true;
  ctx.click(byId(ctx, "moveConfirm"));
  assert.equal(T(ctx).isRootLevel(by.B.id), true);
  close(target(by.B), 0.5);
  ctx.close();
});

test("UI: «В группу» без отметки — ошибка и окно остаётся открытым", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  ctx.addFolder("Ф");
  ctx.click(cardButton(ctx, by.A, "to-group"));
  ctx.click(byId(ctx, "moveConfirm"));
  assert.equal(modalOpen(ctx), true);
  assert.match(byId(ctx, "modalError").textContent, /Отметьте/);
  ctx.close();
});

// =====================================================================
//  Папка: название, сворачивание, удаление
// =====================================================================

test("UI: переименование папки через поле сохраняется в localStorage и в снимке облака", () => {
  const { ctx } = world([{ name: "A", t: 1 }]);
  const f = ctx.addFolder("Старое");
  const input = byId(ctx, `folder-name-${f.id}`);
  input.value = "Новое имя";
  ctx.change(input);
  assert.equal(T(ctx).folderName(f.id), "Новое имя");
  const stored = JSON.parse(ctx.window.localStorage.getItem("tree"));
  assert.equal(stored[stored.length - 1].name, "Новое имя");
  ctx.close();
});

test("UI: сворачивание папки не трогает ни цели, ни облако, ни проекцию снимка", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  const calls = [];
  const bump = ctx.CloudSync.bumpControl;
  ctx.CloudSync.bumpControl = (...a) => (calls.push("bump"), bump.apply(ctx.CloudSync, a));
  const interactive = ctx.CloudSync.interactiveSync;
  ctx.CloudSync.interactiveSync = (...a) => (calls.push("sync"), interactive.apply(ctx.CloudSync, a));
  const before = JSON.stringify(ctx.CloudSync.meaningfulProjection(ctx.CloudSync.snapshotLocal()));
  const toggle = byId(ctx, `folder-toggle-${f.id}`);
  ctx.click(toggle);
  assert.equal(ctx.FolderView.isCollapsed(f.id), true);
  assert.equal(ctx.isVisible(ctx.cardById(by.B.id)), false, "содержимое скрыто");
  ctx.click(toggle);
  assert.equal(ctx.FolderView.isCollapsed(f.id), false);
  assert.equal(ctx.isVisible(ctx.cardById(by.B.id)), true, "содержимое снова видно");
  assert.deepEqual(calls, [], "сворачивание — чисто визуальное действие");
  const after = JSON.stringify(ctx.CloudSync.meaningfulProjection(ctx.CloudSync.snapshotLocal()));
  assert.equal(after, before, "осмысленный снимок не изменился");
  ctx.close();
});

test("UI: «Удалить» группу убирает папку, все её карточки и пересчитывает уровень выше", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.4 },
    { name: "B", t: 0.4 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  const sub = T(ctx).createFolder("Под", f);
  ctx.TimerView.renderTree();
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, sub.id);
  ctx.click(cardButton(ctx, f, "delete-folder"));
  assert.equal(ctx.folderEl(f.id), null, "папка убрана из DOM");
  assert.equal(ctx.folderEl(sub.id), null, "вложенная — тоже");
  assert.equal(ctx.cardById(by.B.id), null);
  assert.equal(ctx.cardById(by.C.id), null);
  assert.deepEqual(
    ctx.AppState.getTimers().map(t => t.name),
    ["A"]
  );
  close(target(by.A), 1, "A получила всё освободившееся");
  ctx.close();
});

test("UI: удаление таймера в папке — доли остальных растут пропорционально, сумма папки та же", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "x", t: 0.25 },
    { name: "y", t: 0.15 },
    { name: "z", t: 0.1 },
  ]);
  const f = ctx.addFolder("Ф");
  ["x", "y", "z"].forEach(n => ctx.moveToFolder(by[n].id, f.id));
  ctx.click(cardButton(ctx, by.x, "delete"));
  close(T(ctx).folderTarget(f.id), 0.5, "сумма папки сохранилась");
  close(target(by.y) / target(by.z), 1.5, "пропорция между оставшимися прежняя (0.15 : 0.1)");
  close(target(by.A), 0.5, "корень не тронут");
  ctx.close();
});

// =====================================================================
//  «Целевая пропорция» и «Доля» в интерфейсе
// =====================================================================

test("UI: ввод «Целевой пропорции» больше 1 обрезается до 1, поле показывает 1", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.5 },
  ]);
  const input = ctx.elementOf(by.A.id, "target");
  input.value = "3";
  ctx.change(input);
  close(target(by.A), 1);
  close(target(by.B), 0);
  assert.equal(Number(ctx.elementOf(by.A.id, "target").value), 1, "поле показывает 1");
  assert.equal(Number(ctx.elementOf(by.B.id, "target").value), 0, "и у B — 0");
  ctx.close();
});

test("UI: поле «Доля» после правки цели внутри папки показывает новое значение", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  const t = ctx.elementOf(by.B.id, "target");
  t.value = "0.4"; // глобальная правка цели B: остальные — в одно и то же число раз
  ctx.change(t);
  const expectedShare = target(by.B) / (target(by.B) + target(by.C));
  assert.equal(ctx.shareInput(by.B.id).value, expectedShare.toFixed(4));
  assert.equal(ctx.shareInput(by.C.id).value, (1 - expectedShare).toFixed(4));
  ctx.close();
});

test("UI: пустое поле «Доля» не ломает состояние (значение возвращается)", () => {
  const { ctx, by } = world([
    { name: "A", t: 0.5 },
    { name: "B", t: 0.3 },
    { name: "C", t: 0.2 },
  ]);
  const f = ctx.addFolder("Ф");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  const input = ctx.shareInput(by.B.id);
  input.value = "";
  ctx.change(input);
  close(target(by.B), 0.3, "цель не изменилась");
  assert.equal(input.value, "0.6000", "в поле вернулась доля 0.6");
  ctx.close();
});
