// Названия на основном экране: у таймеров и групп все названия различны,
// пустое название — ошибка. Нарушение при потере фокуса: прежнее название
// возвращается, внизу экрана показывается текст ошибки. Те же правила
// действуют в окнах создания/разбиения. Причина: таймер можно «разбить» в
// группу, а «Конструктор дня» считает одноимённую сущность своей Частью.
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, DEFAULT_END } = require("./harness.js");

after(closeAll);

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
const byId = (ctx, id) => ctx.document.getElementById(id);
const toast = ctx => byId(ctx, "appToast");
const toastText = ctx => toast(ctx).textContent;
const toastShown = ctx => toast(ctx).classList.contains("show");
function renameTimer(ctx, timer, value) {
  const input = ctx.card(timer).querySelector('input[data-action="name"]');
  input.value = value;
  ctx.change(input);
  return input;
}
function renameFolder(ctx, folder, value) {
  const input = byId(ctx, `folder-name-${folder.id}`);
  input.value = value;
  ctx.change(input);
  return input;
}
const modalOpen = ctx => !byId(ctx, "modalOverlay").classList.contains("hidden");
const qa = (ctx, sel) => Array.from(ctx.document.querySelectorAll(sel));

test("название таймера, совпавшее с чужим, возвращается прежним и показывается ошибка", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  assert.equal(toastShown(ctx), false, "ошибки нет, пока всё в порядке");
  const input = renameTimer(ctx, by.Спорт, "Работа");
  assert.equal(by.Спорт.name, "Спорт", "модель не изменилась");
  assert.equal(input.value, "Спорт", "поле вернулось к прежнему названию");
  assert.equal(toastShown(ctx), true);
  assert.match(toastText(ctx), /«Работа» уже занято/);
  ctx.close();
});

test("совпадение без учёта регистра и лишних пробелов тоже ошибка", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  renameTimer(ctx, by.Спорт, "  рАБОТА ");
  assert.equal(by.Спорт.name, "Спорт");
  renameTimer(ctx, by.Спорт, "Ра  бота");
  assert.equal(by.Спорт.name, "Ра бота", "это уже другое название: пробелы внутри схлопываются, но слово иное");
  ctx.close();
});

test("пустое название таймера — ошибка, прежнее возвращается", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  const input = renameTimer(ctx, by.Работа, "   ");
  assert.equal(by.Работа.name, "Работа");
  assert.equal(input.value, "Работа");
  assert.match(toastText(ctx), /не может быть пустым/);
  ctx.close();
});

test("допустимое название сохраняется без лишних пробелов; смена регистра своего же имени — можно", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  const input = renameTimer(ctx, by.Спорт, "   Бег   по утрам ");
  assert.equal(by.Спорт.name, "Бег по утрам");
  assert.equal(input.value, "Бег по утрам");
  renameTimer(ctx, by.Работа, "РАБОТА");
  assert.equal(by.Работа.name, "РАБОТА", "своё же название другим регистром — не конфликт");
  assert.equal(toastShown(ctx), false);
  ctx.close();
});

test("таймер и группа не могут называться одинаково (в обе стороны)", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  const f = ctx.addFolder("Проекты");
  renameTimer(ctx, by.Работа, "проекты");
  assert.equal(by.Работа.name, "Работа", "таймеру нельзя назваться как группа");
  assert.match(toastText(ctx), /группа/);
  const input = renameFolder(ctx, f, "Спорт");
  assert.equal(ctx.TreeModel.folderName(f.id), "Проекты", "группе нельзя назваться как таймер");
  assert.equal(input.value, "Проекты");
  assert.match(toastText(ctx), /таймер/);
  ctx.close();
});

test("название группы: пустое и совпавшее с другой группой — ошибка", () => {
  const { ctx } = world([["A", 1]]);
  const f1 = ctx.addFolder("Первая");
  const f2 = ctx.addFolder("Вторая");
  renameFolder(ctx, f2, "ПЕРВАЯ");
  assert.equal(ctx.TreeModel.folderName(f2.id), "Вторая");
  renameFolder(ctx, f2, "");
  assert.equal(ctx.TreeModel.folderName(f2.id), "Вторая");
  assert.match(toastText(ctx), /пустым/);
  renameFolder(ctx, f1, "Главная");
  assert.equal(ctx.TreeModel.folderName(f1.id), "Главная");
  ctx.close();
});

test("ошибка названия сама скрывается позже, а новая заменяет прежний текст", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  renameTimer(ctx, by.Спорт, "Работа");
  const first = toastText(ctx);
  renameTimer(ctx, by.Спорт, "");
  assert.notEqual(toastText(ctx), first, "показан текст последней ошибки");
  ctx.close();
});

test("сохранённое переименование уходит в хранилище; отклонённое — нет", () => {
  const { ctx, by } = world([["Работа", 0.5], ["Спорт", 0.5]]);
  renameTimer(ctx, by.Спорт, "Работа");
  ctx.StorageService.saveToLocalStorage();
  const names = JSON.parse(ctx.window.localStorage.getItem("timers")).map(t => t.name);
  assert.deepEqual(names.sort(), ["Работа", "Спорт"]);
  ctx.close();
});

// =====================================================================
//  Окна создания
// =====================================================================

test("«+ Добавить таймер»: пустое и занятое название отклоняются, окно остаётся открытым", () => {
  const { ctx } = world([["Работа", 1]]);
  const open = () => {
    ctx.click(ctx.document.querySelector('#globalControls button[data-action="add-timer"]'));
    assert.ok(modalOpen(ctx));
  };
  open();
  byId(ctx, "addTaskName").value = "";
  byId(ctx, "addTaskProportion").value = "0.5";
  ctx.click(byId(ctx, "addTaskConfirm"));
  assert.ok(modalOpen(ctx));
  assert.match(byId(ctx, "modalError").textContent, /пустым/);
  byId(ctx, "addTaskName").value = "работа";
  ctx.click(byId(ctx, "addTaskConfirm"));
  assert.ok(modalOpen(ctx));
  assert.match(byId(ctx, "modalError").textContent, /уже занято/);
  assert.equal(ctx.AppState.getTimers().length, 1);
  byId(ctx, "addTaskName").value = "Чтение";
  ctx.click(byId(ctx, "addTaskConfirm"));
  assert.equal(modalOpen(ctx), false);
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("«Создать группу»: предлагается свободное название («Группа», «Группа 2», …)", () => {
  const { ctx } = world([["A", 1]]);
  const create = name => {
    ctx.click(ctx.document.querySelector("#menuButton"));
    ctx.click(ctx.document.querySelector('#operationsMenu button[data-action="create-group"]'));
    const suggested = byId(ctx, "createGroupName").value;
    byId(ctx, "createGroupName").value = name === null ? suggested : name;
    ctx.click(byId(ctx, "createGroupConfirm"));
    return suggested;
  };
  assert.equal(create(null), "Группа");
  assert.equal(create(null), "Группа 2", "«Группа» уже занята");
  assert.equal(create(null), "Группа 3");
  // занятое вручную — ошибка
  ctx.click(ctx.document.querySelector("#menuButton"));
  ctx.click(ctx.document.querySelector('#operationsMenu button[data-action="create-group"]'));
  byId(ctx, "createGroupName").value = "a";
  ctx.click(byId(ctx, "createGroupConfirm"));
  assert.ok(modalOpen(ctx));
  assert.match(byId(ctx, "modalError").textContent, /уже занято/);
  ctx.close();
});

test("«Разбить»: названия подзадач различны, не заняты, не совпадают с названием группы", () => {
  const { ctx, by } = world([["Чтение", 0.5], ["Спорт", 0.5]]);
  const open = () => {
    ctx.click(ctx.card(by.Чтение).querySelector('button[data-action="split"]'));
    return qa(ctx, "#splitRows .split-row");
  };
  const fill = (rows, a, b) => {
    rows[0].querySelector(".split-name").value = a;
    rows[1].querySelector(".split-name").value = b;
  };
  let rows = open();
  fill(rows, "Книга", "книга");
  ctx.click(byId(ctx, "splitConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /различаться/);
  fill(rows, "Книга", "Спорт");
  ctx.click(byId(ctx, "splitConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /уже занято/);
  fill(rows, "Книга", "Статьи");
  byId(ctx, "splitFolderName").value = "статьи";
  ctx.click(byId(ctx, "splitConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /группы|подзадач/);
  byId(ctx, "splitFolderName").value = "Чтение";
  ctx.click(byId(ctx, "splitConfirm"));
  assert.equal(modalOpen(ctx), false, "название группы может повторять разбиваемый таймер — он исчезает");
  assert.equal(ctx.TreeModel.allFolderNodes()[0].name, "Чтение");
  ctx.close();
});

test("«Создать задачу внутри группы»: имя новой задачи — свободное и непустое", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.click(ctx.document.querySelector("#menuButton"));
  ctx.click(ctx.document.querySelector('#operationsMenu button[data-action="create-in-group"]'));
  qa(ctx, ".group-checkbox")[0].checked = true;
  byId(ctx, "groupTaskProportion").value = "0.5";
  byId(ctx, "groupTaskName").value = "b";
  ctx.click(byId(ctx, "groupTaskConfirm"));
  assert.ok(modalOpen(ctx));
  assert.match(byId(ctx, "modalError").textContent, /уже занято/);
  byId(ctx, "groupTaskName").value = "";
  ctx.click(byId(ctx, "groupTaskConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /пустым/);
  byId(ctx, "groupTaskName").value = "C";
  ctx.click(byId(ctx, "groupTaskConfirm"));
  assert.equal(modalOpen(ctx), false);
  assert.ok(ctx.AppState.getTimers().some(t => t.name === "C"));
  ctx.close();
});

test("на уровне модели названия не навязываются (старые сохранения с дублями загружаются)", () => {
  const ctx = setup();
  const a = ctx.addTimer({ name: "Дубль", proportion: 0.5, targetProportion: 0.5 });
  const b = ctx.addTimer({ name: "Дубль", proportion: 0.5, targetProportion: 0.5 });
  assert.equal(a.name, b.name);
  // но правка любого из них на то же самое название — не ошибка (ничего не меняется)
  const input = ctx.card(a).querySelector('input[data-action="name"]');
  input.value = "Дубль";
  ctx.change(input);
  assert.equal(toastShown(ctx), false);
  // а сменить на занятое другое — нельзя
  const c = ctx.addTimer({ name: "Другое", proportion: 0, targetProportion: 0 });
  renameTimer(ctx, c, "дубль");
  assert.equal(c.name, "Другое");
  ctx.close();
});
