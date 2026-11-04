// «Конструктор дня»: окно (раздел 7) — всё делается настоящими кликами и
// вводом в поля, как это делает пользователь.
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
  const ctx = setup();
  const by = {};
  specs.forEach(([name, target]) => {
    by[name] = ctx.addTimer({ name, proportion: target, targetProportion: target });
  });
  if (opts.end) ctx.setEndTime(opts.end);
  return { ctx, by };
}
const q = (ctx, sel) => ctx.document.querySelector(sel);
const qa = (ctx, sel) => Array.from(ctx.document.querySelectorAll(sel));
const modalOpen = ctx =>
  !ctx.document.getElementById("modalOverlay").classList.contains("hidden");

function openBuilder(ctx) {
  ctx.click(q(ctx, "#menuButton"));
  ctx.click(q(ctx, '#operationsMenu button[data-action="day-builder"]'));
  assert.equal(modalOpen(ctx), true, "окно открылось");
}
/** Строка окна по названию. */
function row(ctx, name) {
  const found = qa(ctx, "#ddList .dd-row").find(
    r => r.querySelector(".dd-name").value === name
  );
  assert.ok(found, `строка «${name}» есть в окне`);
  return found;
}
const rowNames = ctx => qa(ctx, "#ddList .dd-row").map(r => r.querySelector(".dd-name").value);
const setField = (ctx, name, cls, value, evt = "change") => {
  const input = row(ctx, name).querySelector(cls);
  input.value = value;
  if (evt === "change") ctx.change(input);
  else ctx.inputEvent(input);
};
const setTime = (ctx, name, s, e) => {
  setField(ctx, name, ".dd-start", s);
  setField(ctx, name, ".dd-end", e);
};
const btn = (ctx, name, action) =>
  row(ctx, name).querySelector(`button[data-dd-action="${action}"]`);
const click = (ctx, selector) => ctx.click(q(ctx, selector));
const errors = ctx => ctx.document.getElementById("modalError").textContent;

function createActivity(ctx, name, s, e) {
  ctx.click(q(ctx, 'button[data-dd-action="new-activity"]'));
  ctx.document.getElementById("ddNewName").value = name;
  ctx.document.getElementById("ddNewStart").value = s || "";
  ctx.document.getElementById("ddNewEnd").value = e || "";
  click(ctx, "#ddCreateConfirm");
}
function createGroup(ctx, name) {
  ctx.click(q(ctx, 'button[data-dd-action="new-group"]'));
  ctx.document.getElementById("ddNewName").value = name;
  click(ctx, "#ddCreateConfirm");
}

// =====================================================================
//  7. Окно и доступные действия
// =====================================================================

test("7.1: в меню «Операции» есть «Конструктор дня», он открывает модальное окно", () => {
  const { ctx } = world([["A", 1]]);
  const item = q(ctx, '#operationsMenu button[data-action="day-builder"]');
  assert.ok(item);
  assert.equal(item.textContent.trim(), "Конструктор дня");
  openBuilder(ctx);
  assert.equal(ctx.DayBuilder.isOpen(), true);
  assert.match(q(ctx, "#modalBox .modal-title").textContent, /Конструктор дня/);
  ctx.close();
});

test("3.3: на основном экране есть поле «Начало (для конструктора)» со значением 00:00", () => {
  const { ctx } = world([["A", 1]]);
  const field = ctx.document.getElementById("scheduleStart");
  assert.ok(field);
  assert.equal(field.value, "00:00");
  assert.match(ctx.document.getElementById("scheduleStartLabel").textContent, /Начало \(для конструктора\)/);
  ctx.close();
});

test("7.3: набор опций окна — группа, активность, «Сохранить», «Закрыть»; на строках всё нужное", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  const texts = qa(ctx, "#modalBox button").map(b => b.textContent.trim());
  ["Создать группу", "Создать активность", "Сохранить", "Закрыть"].forEach(t =>
    assert.ok(texts.includes(t), `кнопка «${t}»`)
  );
  const r = row(ctx, "A");
  assert.ok(r.querySelector(".dd-name"), "переименование (7.3.8)");
  assert.ok(r.querySelector(".dd-start") && r.querySelector(".dd-end"), "интервал (7.3.3)");
  const trash = r.querySelector('button[data-dd-action="clear-end"]');
  assert.ok(trash, "значок корзины рядом с концом (7.3.5)");
  assert.equal(trash.getAttribute("title"), "Удалить конец");
  assert.ok(r.querySelector('button[data-dd-action="to-group"]'), "«В группу» (7.3.6)");
  assert.ok(r.querySelector('button[data-dd-action="delete"]'), "удаление (7.3.9)");
  assert.equal(r.querySelector('button[data-dd-action="from-group"]'), null, "«Из группы» только в группе");
  assert.match(r.querySelector(".dd-duration").textContent, /^Длительность: /, "подпись «Длительность» (7.3.10)");
  ctx.close();
});

test("7.4/9.7.3/2.3: ни Доли, ни Цели, ни Веса в окне нет; слова «папка» тоже", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Моя");
  ctx.moveToFolder(ctx.AppState.getTimers()[0].id, f.id);
  openBuilder(ctx);
  const text = q(ctx, "#modalBox").textContent;
  assert.doesNotMatch(text, /Доля|Цель|Целев|Вес|Пропорц/);
  assert.doesNotMatch(text, /[Пп]апк/);
  assert.match(text, /Группа конструктора/);
  assert.equal(qa(ctx, '#modalBox input[type="number"]').length, 0, "числовых полей нет");
  ctx.close();
});

test("9.5.16: уровни вложенности показываются отступами", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const outer = ctx.addFolder("Внешняя");
  const inner = ctx.TreeModel.createFolder("Внутренняя", outer);
  ctx.TimerView.renderTree();
  ctx.moveToFolder(by.A.id, inner.id);
  openBuilder(ctx);
  const margin = name => parseInt(row(ctx, name).style.marginLeft || "0", 10);
  assert.ok(margin("Внутренняя") > margin("Внешняя"));
  assert.ok(margin("A") > margin("Внутренняя"));
  assert.equal(row(ctx, "A").getAttribute("data-depth"), "2");
  ctx.close();
});

test("«Закрыть» откатывает правки; клик мимо окна его не закрывает", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  setField(ctx, "A", ".dd-name", "Черновик");
  click(ctx, "#modalOverlay");
  assert.equal(modalOpen(ctx), true, "клик по подложке окно не закрывает");
  click(ctx, "#ddClose");
  assert.equal(modalOpen(ctx), false);
  assert.equal(by.A.name, "A", "на основном экране ничего не изменилось");
  openBuilder(ctx);
  assert.deepEqual(rowNames(ctx), ["A", "B"], "черновик не хранится (6.5)");
  ctx.close();
});

// =====================================================================
//  Время, подсветка, корзина
// =====================================================================

test("9.3.1/9.3.2: пересечение вводится свободно, красная подсветка появляется сразу — ещё при наборе", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "11:00");
  setTime(ctx, "B", "11:00", "12:00");
  assert.equal(qa(ctx, ".dd-red").length, 0);
  // набираем конец B = 11:30 → пересечение; событие input, без change
  setField(ctx, "B", ".dd-start", "10:00", "input");
  assert.equal(row(ctx, "A").classList.contains("dd-red"), true, "A красная до нажатия «Сохранить»");
  assert.equal(row(ctx, "B").classList.contains("dd-red"), true);
  // ввод не применён: поле осталось набранным, после change — применится
  setField(ctx, "B", ".dd-start", "11:00", "input");
  assert.equal(qa(ctx, ".dd-red").length, 0, "9.3.3: конфликт устранён — подсветка ушла");
  ctx.close();
});

test("9.3.5/5.7: единственный промежуток — синяя подсветка двух активностей", () => {
  const { ctx } = world([["A", 1 / 3], ["B", 1 / 3], ["C", 1 / 3]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "11:00");
  setTime(ctx, "B", "11:00", "13:00");
  setTime(ctx, "C", "13:00", "15:00");
  const blue = qa(ctx, ".dd-blue").map(r => r.querySelector(".dd-name").value).sort();
  assert.deepEqual(blue, ["A", "C"]);
  assert.equal(qa(ctx, ".dd-red").length, 0);
  // вторая дыра → синий гаснет, включается красный
  setTime(ctx, "B", "12:00", "13:00");
  assert.equal(qa(ctx, ".dd-blue").length, 0);
  assert.ok(qa(ctx, ".dd-red").length >= 2);
  ctx.close();
});

test("4.7: корзина «Удалить конец» убирает конец, начало остаётся, длительность — прочерк", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "10:30");
  assert.match(row(ctx, "A").querySelector(".dd-duration").textContent, /1ч 30м/);
  ctx.click(btn(ctx, "A", "clear-end"));
  assert.equal(row(ctx, "A").querySelector(".dd-end").value, "");
  assert.equal(row(ctx, "A").querySelector(".dd-start").value, "09:00");
  assert.match(row(ctx, "A").querySelector(".dd-duration").textContent, /—/);
  assert.equal(qa(ctx, "#ddEmptyTitle").length, 0, "в «Пустое» не ушла (4.7.1)");
  ctx.close();
});

test("4.3: конец 00:00 показывается как 24:00; интервал на всю ночь 22:00–06:00 = 8 ч", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  setTime(ctx, "A", "22:00", "00:00");
  assert.equal(row(ctx, "A").querySelector(".dd-end").value, "24:00");
  assert.match(row(ctx, "A").querySelector(".dd-duration").textContent, /2ч 0м/);
  setTime(ctx, "A", "22:00", "06:00");
  assert.match(row(ctx, "A").querySelector(".dd-duration").textContent, /8ч 0м/);
  ctx.close();
});

test("4.6: равные начало и конец в окне — 24 часа", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  setTime(ctx, "A", "1:00", "1:00");
  assert.match(row(ctx, "A").querySelector(".dd-duration").textContent, /24ч 0м/);
  ctx.close();
});

test("некорректное время отклоняется сообщением, значение возвращается", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "10:00");
  setField(ctx, "A", ".dd-start", "25:99");
  assert.match(errors(ctx), /чч:мм/);
  assert.equal(row(ctx, "A").querySelector(".dd-start").value, "09:00");
  setField(ctx, "A", ".dd-end", "10:00:30");
  assert.match(errors(ctx), /чч:мм/, "секунд нет (4.1)");
  ctx.close();
});

test("конец без начала не вводится", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createActivity(ctx, "Пустая", "", "");
  setField(ctx, "Пустая", ".dd-end", "10:00");
  assert.match(errors(ctx), /начал/i);
  assert.equal(row(ctx, "Пустая").querySelector(".dd-end").value, "");
  ctx.close();
});

// =====================================================================
//  Создание
// =====================================================================

test("9.2.1: «Создать активность» — окно с названием и временем; название обязательно", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  ctx.click(q(ctx, 'button[data-dd-action="new-activity"]'));
  assert.ok(ctx.document.getElementById("ddNewName"));
  assert.ok(ctx.document.getElementById("ddNewStart") && ctx.document.getElementById("ddNewEnd"));
  assert.equal(ctx.document.getElementById("ddNewStart").value, "", "значений по умолчанию нет (9.2.2)");
  click(ctx, "#ddCreateConfirm");
  assert.match(errors(ctx), /Название обязательно/);
  ctx.document.getElementById("ddNewName").value = "Йога";
  click(ctx, "#ddCreateConfirm");
  assert.ok(row(ctx, "Йога"), "активность создана");
  ctx.close();
});

test("9.2.3/9.6: активность без времени попадает в раздел «Пустое» в самом низу", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "10:00");
  createActivity(ctx, "Потом", "", "");
  createActivity(ctx, "Рано", "6:00", "7:00");
  const title = ctx.document.getElementById("ddEmptyTitle");
  assert.ok(title, "заголовок «Пустое»");
  assert.equal(title.textContent, "Пустое");
  assert.deepEqual(rowNames(ctx), ["Рано", "A", "Потом"], "основной список по времени, «Пустое» внизу");
  const list = qa(ctx, "#ddList > *");
  const titleAt = list.findIndex(el => el.id === "ddEmptyTitle");
  const laterAt = list.findIndex(el => el.classList.contains("dd-row") && el.querySelector(".dd-name").value === "Потом");
  assert.ok(titleAt > -1 && laterAt > titleAt, "«Потом» — после заголовка «Пустое»");
  assert.match(row(ctx, "Потом").textContent, /Активность без времени/);
  ctx.close();
});

test("9.2.4/8.3: новая активность на корневом уровне; начало внутри группы кладёт её в группу", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createGroup(ctx, "Работа");
  setTime(ctx, "Работа", "9:00", "13:00");
  createActivity(ctx, "Вне", "15:00", "16:00");
  createActivity(ctx, "Внутри", "10:00", "11:00");
  assert.equal(row(ctx, "Вне").getAttribute("data-depth"), "0");
  assert.equal(row(ctx, "Внутри").getAttribute("data-depth"), "1", "внутри группы");
  ctx.close();
});

test("9.2.5: группа создаётся с названием, до начала лежит в «Пустом»", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  ctx.click(q(ctx, 'button[data-dd-action="new-group"]'));
  click(ctx, "#ddCreateConfirm");
  assert.match(errors(ctx), /Название обязательно/);
  ctx.document.getElementById("ddNewName").value = "Проекты";
  click(ctx, "#ddCreateConfirm");
  assert.ok(row(ctx, "Проекты").classList.contains("dd-group"));
  const list = qa(ctx, "#ddList > *");
  assert.ok(list.findIndex(e => e.id === "ddEmptyTitle") < list.findIndex(e => e.classList.contains("dd-group")));
  ctx.close();
});

test("«Отмена» в окне создания возвращает к списку без изменений", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  ctx.click(q(ctx, 'button[data-dd-action="new-activity"]'));
  click(ctx, "#ddBack");
  assert.deepEqual(rowNames(ctx), ["A"]);
  ctx.close();
});

// =====================================================================
//  «В группу» / «Из группы»
// =====================================================================

test("9.5.1: «В группу» открывает выбор, отмечается ровно одна группа", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  createGroup(ctx, "Г1");
  createGroup(ctx, "Г2");
  setTime(ctx, "Г1", "9:00", "12:00");
  setTime(ctx, "Г2", "12:00", "15:00");
  setTime(ctx, "A", "15:00", "16:00");
  ctx.click(btn(ctx, "A", "to-group"));
  assert.equal(qa(ctx, ".dd-pick").length, 2, "обе группы в списке");
  click(ctx, "#ddPickConfirm");
  assert.match(errors(ctx), /ровно одну/);
  qa(ctx, ".dd-pick").forEach(c => (c.checked = true));
  click(ctx, "#ddPickConfirm");
  assert.match(errors(ctx), /ровно одну/, "две — тоже нельзя");
  qa(ctx, ".dd-pick")[1].checked = false;
  click(ctx, "#ddPickConfirm");
  assert.equal(row(ctx, "A").getAttribute("data-depth"), "1", "A в группе");
  ctx.close();
});

test("9.5.3: после «В группу» начало сущности совпадает с началом группы", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createGroup(ctx, "Группа");
  setTime(ctx, "Группа", "9:00", "12:00");
  setTime(ctx, "A", "15:00", "16:00");
  ctx.click(btn(ctx, "A", "to-group"));
  qa(ctx, ".dd-pick")[0].checked = true;
  click(ctx, "#ddPickConfirm");
  assert.equal(row(ctx, "A").querySelector(".dd-start").value, "09:00");
  assert.equal(row(ctx, "A").querySelector(".dd-end").value, "10:00", "длительность прежняя");
  ctx.close();
});

test("9.5.6: у активности без времени «В группу» нет, у группы (даже пустой, без времени) — есть", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createActivity(ctx, "Свободная", "", "");
  createGroup(ctx, "Пустая");
  assert.equal(btn(ctx, "Свободная", "to-group"), null);
  assert.ok(btn(ctx, "Пустая", "to-group"));
  ctx.close();
});

test("9.5.1: в выборе нет самой группы и её потомков", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createGroup(ctx, "Внешняя");
  createGroup(ctx, "Внутренняя");
  createGroup(ctx, "Чужая");
  setTime(ctx, "Внешняя", "8:00", "12:00");
  setTime(ctx, "Внутренняя", "12:00", "14:00");
  ctx.click(btn(ctx, "Внутренняя", "to-group"));
  qa(ctx, ".dd-pick").find(c => true).checked = true;
  const labels = qa(ctx, "#ddPickList label").map(l => l.textContent.trim());
  assert.ok(!labels.includes("Внутренняя"), "саму себя нельзя");
  click(ctx, "#ddBack");
  ctx.click(btn(ctx, "Внешняя", "to-group"));
  const options = qa(ctx, "#ddPickList label").map(l => l.textContent.trim());
  assert.ok(!options.includes("Внешняя"));
  ctx.close();
});

test("9.5.9/9.5.10: «Из группы» есть только у вложенных; сущность уходит на корень, начало = концу группы", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createGroup(ctx, "Группа");
  setTime(ctx, "Группа", "9:00", "12:00");
  createActivity(ctx, "Внутри", "9:00", "10:00");
  assert.ok(btn(ctx, "Внутри", "from-group"));
  assert.equal(btn(ctx, "Группа", "from-group"), null);
  ctx.click(btn(ctx, "Внутри", "from-group"));
  assert.equal(row(ctx, "Внутри").getAttribute("data-depth"), "0");
  assert.equal(row(ctx, "Внутри").querySelector(".dd-start").value, "12:00");
  assert.equal(row(ctx, "Внутри").querySelector(".dd-end").value, "13:00");
  assert.equal(btn(ctx, "Внутри", "from-group"), null);
  ctx.close();
});

test("7.3.9: «Удалить» убирает активность, группа — вместе с содержимым", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  createGroup(ctx, "Группа");
  setTime(ctx, "Группа", "9:00", "12:00");
  createActivity(ctx, "Внутри", "9:00", "12:00");
  ctx.click(btn(ctx, "Группа", "delete"));
  assert.deepEqual(rowNames(ctx).sort(), ["A", "B"]);
  ctx.click(btn(ctx, "A", "delete"));
  assert.deepEqual(rowNames(ctx), ["B"]);
  ctx.close();
});

// =====================================================================
//  «Сохранить»
// =====================================================================

test("9.3.6: «Сохранить» при конфликтах показывает ошибку, окно открыто, ничего не применено", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "11:00");
  setTime(ctx, "B", "10:00", "12:00");
  setField(ctx, "A", ".dd-name", "Переименована");
  click(ctx, "#ddSave");
  assert.equal(modalOpen(ctx), true, "окно осталось открытым");
  assert.match(errors(ctx), /пересека/);
  assert.equal(by.A.name, "A", "изменения не применены");
  near(by.A.targetProportion, 0.5, "Цель A");
  // исправили — сохраняется
  setTime(ctx, "B", "11:00", "12:00");
  click(ctx, "#ddSave");
  assert.equal(modalOpen(ctx), false, "окно закрылось");
  assert.equal(by.A.name, "Переименована");
  near(by.A.targetProportion, 2 / 3, "Цель A = 2 ч из 3");
  near(by.B.targetProportion, 1 / 3, "Цель B = 1 ч из 3");
  ctx.close();
});

test("9.3.7: ошибки блокировки перечислены текстом (свободное время в группе, пустая группа, группа без времени)", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  createGroup(ctx, "Пустая");
  setTime(ctx, "Пустая", "13:00", "13:30");
  click(ctx, "#ddSave");
  assert.match(errors(ctx), /без содержимого/);
  ctx.click(btn(ctx, "Пустая", "clear-end"));
  createGroup(ctx, "Без времени");
  ctx.click(btn(ctx, "A", "to-group"));
  qa(ctx, ".dd-pick").find(c => c.closest("label").textContent.includes("Без времени")).checked = true;
  click(ctx, "#ddPickConfirm");
  click(ctx, "#ddSave");
  assert.match(errors(ctx), /не задан временной диапазон/);
  ctx.close();
});

test("10.1: до «Сохранить» основной экран не меняется", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const timersBefore = ctx.AppState.getTimers().length;
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "10:00");
  setTime(ctx, "B", "10:00", "13:00");
  createActivity(ctx, "Новая", "13:00", "14:00");
  assert.equal(ctx.AppState.getTimers().length, timersBefore);
  near(by.A.targetProportion, 0.5, "Цель A");
  assert.equal(ctx.document.getElementById("scheduleStart").value, "00:00");
  ctx.close();
});

test("10.2: «Сохранить» переносит расписание: Цели, поля «Начало»/«Конец», карточки и планы", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "10:00");
  setTime(ctx, "B", "10:00", "13:00");
  createActivity(ctx, "Новая", "", "");
  click(ctx, "#ddSave");
  assert.equal(modalOpen(ctx), false);
  assert.equal(ctx.document.getElementById("scheduleStart").value, "09:00");
  assert.equal(ctx.document.getElementById("globalEndTime").value, "13:00");
  near(by.A.targetProportion, 0.25, "A");
  near(by.B.targetProportion, 0.75, "B");
  const created = ctx.AppState.getTimers().find(t => t.name === "Новая");
  assert.equal(created.targetProportion, 0, "Цель 0 (10.2.6)");
  assert.ok(ctx.card(created), "карточка на основном экране есть");
  assert.equal(ctx.elementOf(by.A.id, "target").value, "0.25", "поле Цели на карточке обновлено");
  assert.ok(by.A.plannedSeconds > 0 && by.B.plannedSeconds > by.A.plannedSeconds, "планы пересчитаны");
  ctx.close();
});

test("10.2.5: вложенность и имена из окна появляются на основном экране; карточка вложена в папку", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  createGroup(ctx, "Работа");
  setTime(ctx, "Работа", "9:00", "13:00");
  setTime(ctx, "A", "9:00", "11:00");
  setTime(ctx, "B", "11:00", "13:00");
  assert.equal(row(ctx, "A").getAttribute("data-depth"), "1", "A вложилась по времени (8.3)");
  click(ctx, "#ddSave");
  const folder = ctx.TreeModel.allFolderNodes().find(f => f.name === "Работа");
  assert.ok(folder);
  assert.equal(ctx.TreeModel.parentOf(by.A.id).id, folder.id);
  assert.ok(ctx.folderChildrenEl(folder.id).contains(ctx.card(by.A)), "карточка внутри папки в DOM");
  near(ctx.TreeModel.folderTarget(folder.id), 1, "цель группы — сумма содержимого");
  ctx.close();
});

test("10.7: удалить всё в окне и сохранить — на основном экране пусто", () => {
  const { ctx } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  ctx.click(btn(ctx, "A", "delete"));
  ctx.click(btn(ctx, "B", "delete"));
  click(ctx, "#ddSave");
  assert.equal(ctx.AppState.getTimers().length, 0);
  assert.equal(qa(ctx, "#timersContainer .timer-container").length, 0);
  ctx.close();
});

test("после «Сохранить» основной экран снова редактируется", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  openBuilder(ctx);
  click(ctx, "#ddSave");
  assert.equal(ctx.DayBuilder.isOpen(), false);
  ctx.click(ctx.card(by.A).querySelector('button[data-action="delete"]'));
  assert.equal(ctx.AppState.getTimers().length, 1, "удаление работает");
  ctx.close();
});

test("полный сценарий: день 9:00–18:00 с обедом и группой, затем правка на основном экране", () => {
  const { ctx, by } = world([["Почта", 0.5], ["Код", 0.5]], { end: "12:00" });
  openBuilder(ctx);
  setTime(ctx, "Почта", "9:00", "10:00");
  setTime(ctx, "Код", "10:00", "12:00");
  createActivity(ctx, "Обед", "12:00", "13:00");
  createGroup(ctx, "Встречи");
  setTime(ctx, "Встречи", "13:00", "18:00");
  createActivity(ctx, "Созвон", "13:00", "14:00");
  createActivity(ctx, "Ретро", "14:00", "18:00");
  assert.equal(row(ctx, "Созвон").getAttribute("data-depth"), "1");
  assert.equal(qa(ctx, ".dd-blue").length, 2, "синие — первая и последняя");
  click(ctx, "#ddSave");
  assert.equal(modalOpen(ctx), false);
  // 9 часов: Почта 1/9, Код 2/9, Обед 1/9, Встречи 5/9
  near(by.Почта.targetProportion, 1 / 9, "Почта");
  near(by.Код.targetProportion, 2 / 9, "Код");
  const meetings = ctx.TreeModel.allFolderNodes().find(f => f.name === "Встречи");
  near(ctx.TreeModel.folderTarget(meetings.id), 5 / 9, "Встречи");
  assert.equal(ctx.document.getElementById("scheduleStart").value, "09:00");
  assert.equal(ctx.document.getElementById("globalEndTime").value, "18:00");
  // основной экран: удвоили «Почту» — в окне время пересчитано, границы те же
  const t = ctx.elementOf(by.Почта.id, "target");
  t.value = "0.4";
  ctx.change(t);
  openBuilder(ctx);
  assert.equal(row(ctx, "Почта").querySelector(".dd-start").value, "09:00");
  assert.equal(row(ctx, "Встречи").querySelector(".dd-end").value, "18:00");
  assert.equal(qa(ctx, ".dd-red").length, 0, "расписание согласовано");
  ctx.close();
});

test("поле времени выделяется целиком при входе — новое значение вводится поверх старого", () => {
  const { ctx } = world([["A", 1]]);
  openBuilder(ctx);
  setTime(ctx, "A", "9:00", "10:00");
  const input = row(ctx, "A").querySelector(".dd-end");
  input.dispatchEvent(new ctx.window.Event("focusin", { bubbles: true }));
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, input.value.length, "выделено всё значение");
  ctx.close();
});