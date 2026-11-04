// Оформление интерфейса: компактные карточки, моноширинный шрифт, синяя
// тема, расположение по центру, ЧЧ:ММ:СС, цвета «осталось/просрочено»,
// мигающий первый приоритет. Проверяется поведение разметки и стилей, не
// пиксели: DOM-структура карточки (тесты компактного режима) при этом
// остаётся прежней.
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, readHtml, DEFAULT_END } = require("./harness.js");

after(closeAll);

function scene(n = 3, opts = {}) {
  const ctx = setup(opts);
  const timers = Array.from({ length: n }, (_, i) =>
    ctx.addTimer({ name: `T${i + 1}`, proportion: 1 / n, targetProportion: 1 / n })
  );
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, timers };
}
const css = (ctx, el) => ctx.window.getComputedStyle(el);
const rgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`;

// =====================================================================
//  Общая тема
// =====================================================================

test("фон — глубокий синий, шрифт — моноширинный, размер умеренный", () => {
  const { ctx } = scene(1);
  const body = css(ctx, ctx.document.body);
  assert.equal(body.backgroundColor, rgb(10, 21, 48), "глубокий синий фон");
  assert.match(body.fontFamily, /mono/i, "моноширинный шрифт");
  const size = parseFloat(body.fontSize);
  assert.ok(size >= 12 && size <= 14, `базовый шрифт ${size}px — компактный`);
  ctx.close();
});

test("значения времени на карточке не огромные (≤ 16px), подписи мельче значений", () => {
  const { ctx, timers } = scene(2);
  const value = ctx.document.getElementById(`tracked-${timers[0].id}`);
  const label = value.previousElementSibling;
  assert.ok(label && label.classList.contains("lbl"), "над значением есть подпись «Факт»");
  const v = parseFloat(css(ctx, value).fontSize);
  const l = parseFloat(css(ctx, label).fontSize);
  assert.ok(v > 0 && v <= 16, `значение ${v}px`);
  assert.ok(l < v, `подпись ${l}px мельче значения ${v}px`);
  ctx.close();
});

test("панель закреплена сверху и не перекрывает список (sticky)", () => {
  const { ctx } = scene(1);
  assert.equal(css(ctx, ctx.document.getElementById("globalControls")).position, "sticky");
  ctx.close();
});

test("в стилях есть скругления, анимация приоритета и уважение reduced-motion", () => {
  const html = readHtml();
  assert.match(html, /border-radius:\s*12px/);
  assert.match(html, /@keyframes priority-blink/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /background-color:\s*#000000/, "чёрных блоков прежней темы не осталось");
});

// =====================================================================
//  Компоновка
// =====================================================================

test("таймеры расположены по центру, колонкой", () => {
  const { ctx } = scene(3);
  const container = css(ctx, ctx.document.getElementById("timersContainer"));
  assert.equal(container.flexDirection, "column");
  assert.equal(container.alignItems, "center", "по центру, а не слева");
  assert.equal(container.marginLeft, "auto");
  ctx.close();
});

test("карточка — сетка с закруглёнными углами; внутри папки растягивается на всю ширину", () => {
  const { ctx, timers } = scene(2);
  const card = css(ctx, ctx.card(timers[0]));
  assert.equal(card.display, "grid");
  assert.equal(card.borderRadius, "12px");
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(timers[0].id, f.id);
  assert.equal(css(ctx, ctx.folderChildrenEl(f.id)).alignItems, "stretch");
  ctx.close();
});

test("свёрнутая карточка по-прежнему показывает ровно прежний набор строк", () => {
  const { ctx, timers } = scene(2);
  const c = ctx.card(timers[0]);
  const shown = [...c.children]
    .filter(el => css(ctx, el).display !== "none")
    .map(el => el.className.split(" ")[0]);
  for (const cls of [
    "compact-toggle-container",
    "name-input-container",
    "target-container",
    "tracked-display-container",
    "remaining-display-container",
    "priority-display-container",
    "buttons-container",
  ]) {
    assert.ok(shown.includes(cls), `${cls} видна`);
  }
  assert.equal(c.className, "timer-container collapsed", "класс карточки прежний");
  ctx.close();
});

test("папка: стрелка сворачивания по-прежнему справа и последняя в шапке", () => {
  const { ctx, timers } = scene(2);
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(timers[0].id, f.id);
  const header = ctx.folderHeader(f.id);
  const last = header.lastElementChild;
  assert.equal(last.getAttribute("data-action"), "toggle-folder");
  assert.equal(css(ctx, last).marginLeft, "auto");
  assert.equal(css(ctx, header).display, "grid");
  ctx.close();
});

// =====================================================================
//  Формат и цвета времени
// =====================================================================

test("время на карточке — ЧЧ:ММ:СС (02:00:00)", () => {
  const { ctx, timers } = scene(2);
  const a = timers[0];
  a.trackedSeconds = 2 * 3600;
  a.plannedSeconds = 5 * 3600;
  ctx.TimerView.updateDisplay();
  assert.equal(ctx.cardText(a, "tracked"), "02:00:00");
  assert.equal(ctx.cardText(a, "remaining"), "03:00:00");
  assert.equal(ctx.Utils.formatTime(3661), "01:01:01");
  assert.equal(ctx.Utils.formatTime(100 * 3600), "100:00:00", "больше 99 часов не обрезается");
  ctx.close();
});

test("«Осталось»: зелёное, пока время есть, красное — когда просрочено", () => {
  const { ctx, timers } = scene(2);
  const a = timers[0];
  const rem = () => ctx.elementOf(a, "remaining");
  a.plannedSeconds = 600;
  a.trackedSeconds = 100;
  ctx.TimerView.updateDisplay();
  assert.ok(rem().classList.contains("time-ok") && !rem().classList.contains("time-over"));
  assert.equal(css(ctx, rem()).color, rgb(95, 212, 160), "зелёный");
  a.trackedSeconds = 900;
  ctx.TimerView.updateDisplay();
  assert.ok(rem().classList.contains("time-over") && !rem().classList.contains("time-ok"));
  assert.equal(css(ctx, rem()).color, rgb(255, 123, 138), "красный");
  assert.match(ctx.cardText(a, "remaining"), /^-00:05:00$/, "просрочка со знаком");
  ctx.close();
});

// =====================================================================
//  Приоритет и отсчёт
// =====================================================================

test("первый приоритет мигает (класс priority-top) — только у одного таймера", () => {
  const { ctx, timers } = scene(4);
  ctx.AppController.calculateRecommendations();
  const withClass = timers.filter(t => ctx.elementOf(t, "priority").classList.contains("priority-top"));
  assert.equal(withClass.length, 1, "мигает ровно один");
  assert.match(ctx.cardText(withClass[0], "priority"), /^Приоритет: 1$/);
  timers.filter(t => t !== withClass[0]).forEach(t =>
    assert.doesNotMatch(ctx.cardText(t, "priority"), /: 1$/)
  );
  ctx.close();
});

test("единственный таймер не мигает — выбирать не из чего", () => {
  const { ctx, timers } = scene(1);
  ctx.AppController.calculateRecommendations();
  assert.equal(ctx.elementOf(timers[0], "priority").classList.contains("priority-top"), false);
  ctx.close();
});

test("мигание переходит вместе с приоритетом и не меняет текст «Приоритет: N»", () => {
  const { ctx, timers } = scene(3);
  ctx.AppController.calculateRecommendations();
  const first = () => timers.find(t => /: 1$/.test(ctx.cardText(t, "priority")));
  const before = first();
  // у лидера появляется большой Факт — приоритет у другого
  before.trackedSeconds = 3000;
  before.dailyTotalSeconds = 3000;
  before.totalSeconds = 3000;
  before.originalDailyTotalSeconds = 3000;
  ctx.AppController.calculateRecommendations();
  const after = first();
  assert.notEqual(after, before, "приоритет сменился");
  assert.ok(ctx.elementOf(after, "priority").classList.contains("priority-top"));
  assert.equal(ctx.elementOf(before, "priority").classList.contains("priority-top"), false);
  ctx.close();
});

test("идущий отсчёт помечается атрибутом data-tracking, класс карточки не меняется", () => {
  const { ctx, timers } = scene(2);
  const [a, b] = timers;
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(ctx.card(a).getAttribute("data-tracking"), "true");
  assert.equal(ctx.card(b).getAttribute("data-tracking"), "false");
  assert.match(ctx.card(a).className, /^timer-container( collapsed)?$/);
  assert.equal(ctx.cardButton(a, "Пауза") !== undefined, true, "текст кнопки прежний");
  ctx.TimerController.toggleTracking(a.id);
  assert.equal(ctx.card(a).getAttribute("data-tracking"), "false");
  assert.ok(ctx.cardButton(a, "Старт"));
  ctx.close();
});

test("разметка «Факт»/«Осталось»: подпись и значение раздельно, id значений прежние", () => {
  const { ctx, timers } = scene(2);
  const a = timers[0];
  for (const id of ["planned", "tracked", "total", "remaining"]) {
    const value = ctx.document.getElementById(`${id}-${a.id}`);
    assert.ok(value, `${id}-<id> на месте`);
    assert.ok(value.previousElementSibling.classList.contains("lbl"));
  }
  assert.equal(ctx.document.getElementById(`tracked-${a.id}`).previousElementSibling.textContent, "Факт");
  assert.equal(ctx.document.getElementById(`remaining-${a.id}`).previousElementSibling.textContent, "Осталось");
  ctx.close();
});

// =====================================================================
//  Модальные окна и конструктор в той же теме
// =====================================================================

test("модальное окно — в общей теме: скругление, синий фон", () => {
  const { ctx } = scene(1);
  ctx.GroupTaskController.openModal();
  const box = css(ctx, ctx.document.getElementById("modalBox"));
  assert.equal(box.borderRadius, "14px");
  assert.equal(box.backgroundColor, rgb(15, 30, 69));
  ctx.close();
});

test("конструктор дня: строки в той же теме, поля имён достаточно широкие", () => {
  const { ctx } = scene(2);
  ctx.DayBuilder.open();
  const row = ctx.document.querySelector("#ddList .dd-row");
  assert.equal(css(ctx, row).borderRadius, "10px");
  assert.equal(css(ctx, row.querySelector(".dd-name")).width, "150px");
  ctx.DayBuilder.close();
  ctx.close();
});

test("после загрузки приоритеты считаются сразу (initializeOnLoad)", () => {
  const html = readHtml();
  assert.match(
    html,
    /function initializeOnLoad\(\) \{\s*AppController\.init\(\);[\s\S]*?AppController\.calculateRecommendations\(\);/
  );
});

test("фон страницы и карточек однотонный — без градиентов", () => {
  const html = readHtml();
  assert.doesNotMatch(html, /gradient\(/, "в стилях нет градиентов");
  const { ctx, timers } = scene(1);
  assert.equal(css(ctx, ctx.document.body).backgroundImage || "none", "none");
  assert.equal(css(ctx, ctx.card(timers[0])).backgroundImage || "none", "none");
  ctx.close();
});

test("в числовых полях нет стрелок-«крутилок»: значения вводятся только вручную", () => {
  const html = readHtml();
  assert.match(html, /input\[type="number"\]::-webkit-inner-spin-button/);
  assert.match(html, /input\[type="number"\]\s*\{[^}]*appearance:\s*textfield/);
  const { ctx, timers } = scene(1);
  const field = ctx.elementOf(timers[0], "target");
  assert.equal(field.type, "number", "поле по-прежнему числовое: ввод и валидация сохранены");
  ctx.close();
});
