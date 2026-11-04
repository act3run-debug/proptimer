// «Объединить» — обратная операция к «Разбить». На таймере: влить в него
// выбранных сиблингов (таймеры и группы), название остаётся прежним. На
// группе: «Объединить дочернее» (группа превращается в один таймер с её
// названием) или «Объединиться с сиблингами» (с предварительным названием).
// Время и целевые пропорции складываются, сумма уровня не меняется.
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
const T = ctx => ctx.TreeModel;

function world(specs, extra = {}) {
  const ctx = setup();
  const by = {};
  specs.forEach(([name, t, fields]) => {
    by[name] = ctx.addTimer({ name, proportion: t, targetProportion: t, ...(fields || {}) });
  });
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, by, ...extra };
}
const byId = (ctx, id) => ctx.document.getElementById(id);
const qa = (ctx, sel) => Array.from(ctx.document.querySelectorAll(sel));
const modalOpen = ctx => !byId(ctx, "modalOverlay").classList.contains("hidden");
const timerButton = (ctx, t, action) =>
  ctx.card(t).querySelector(`button[data-action="${action}"]`);
const folderButton = (ctx, f, action) =>
  ctx.folderHeader(f.id).querySelector(`button[data-action="${action}"]`);
const names = ctx => Array.from(ctx.AppState.getTimers().map(t => t.name));
const sumT = ctx => ctx.sumTargets();
const totalOf = (ctx, field) =>
  ctx.AppState.getTimers().reduce((s, t) => s + (Number(t[field]) || 0), 0);
/** Отметить в окне объединения нужных сиблингов по названию. */
function tick(ctx, ...labels) {
  qa(ctx, ".merge-checkbox").forEach(cb => {
    const text = cb.parentElement.textContent;
    cb.checked = labels.some(l => text.includes(l));
  });
}
const labelsInModal = ctx => qa(ctx, ".merge-checkbox").map(cb => cb.parentElement.textContent.trim());

// =====================================================================
//  Кнопки и окна
// =====================================================================

test("на таймере и на группе есть кнопка «Объединить»", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Группа");
  assert.equal(timerButton(ctx, by.A, "merge").textContent, "Объединить");
  const btn = folderButton(ctx, f, "merge-folder");
  assert.equal(btn.textContent, "Объединить");
  assert.equal(ctx.folderHeader(f.id).lastElementChild.getAttribute("data-action"), "toggle-folder", "стрелка по-прежнему последняя");
  ctx.close();
});

test("окно таймера предлагает только сиблингов — таймеры и группы того же уровня, без самого себя", () => {
  const { ctx, by } = world([["A", 0.25], ["B", 0.25], ["C", 0.25], ["D", 0.25]]);
  const f = ctx.addFolder("Папка");
  const inner = ctx.addFolder("Вложенная", ctx.TreeModel.findNode(f.id).node);
  ctx.moveToFolder(by.C.id, f.id);
  ctx.moveToFolder(by.D.id, inner.id);
  // A и B — корневые вместе с «Папка»
  ctx.click(timerButton(ctx, by.A, "merge"));
  assert.ok(modalOpen(ctx));
  const labels = labelsInModal(ctx);
  assert.equal(labels.length, 2, "B и «Папка»");
  assert.ok(labels.some(l => l.includes("B")));
  assert.ok(labels.some(l => l.includes("Папка")));
  assert.ok(!labels.some(l => l.includes("C") || l.includes("D")), "вложенные — не сиблинги");
  ctx.click(byId(ctx, "modalCancel"));
  // C лежит в «Папке» вместе с «Вложенной»
  ctx.click(timerButton(ctx, by.C, "merge"));
  const inFolder = labelsInModal(ctx);
  assert.equal(inFolder.length, 1);
  assert.ok(inFolder[0].includes("Вложенная"));
  ctx.close();
});

test("без отметки окно таймера выдаёт ошибку и остаётся открытым", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  ctx.click(timerButton(ctx, by.A, "merge"));
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.ok(modalOpen(ctx));
  assert.match(byId(ctx, "modalError").textContent, /Отметьте/);
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

test("«Отмена» ничего не объединяет", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  ctx.click(timerButton(ctx, by.A, "merge"));
  tick(ctx, "B");
  ctx.click(byId(ctx, "modalCancel"));
  assert.equal(ctx.AppState.getTimers().length, 2);
  ctx.close();
});

// =====================================================================
//  Таймер + сиблинги
// =====================================================================

test("таймер + таймер: время и цель складываются, название прежнее, сиблинг исчезает", () => {
  const { ctx, by } = world([
    ["A", 0.5, { totalSeconds: 100, lifetimeTotalSeconds: 100, dailyTotalSeconds: 100, originalDailyTotalSeconds: 100 }],
    ["B", 0.3, { totalSeconds: 40, lifetimeTotalSeconds: 40, dailyTotalSeconds: 40, originalDailyTotalSeconds: 40 }],
    ["C", 0.2],
  ]);
  by.B.trackedSeconds = 25;
  by.A.trackedSeconds = 10;
  ctx.click(timerButton(ctx, by.A, "merge"));
  tick(ctx, "B");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.equal(modalOpen(ctx), false);
  assert.deepEqual(names(ctx), ["A", "C"], "B вошёл в A");
  near(by.A.targetProportion, 0.8, "цель A = 0.5 + 0.3");
  near(by.A.trackedSeconds, 35, "Факт сложился");
  near(by.A.lifetimeTotalSeconds, 140, "«Всего» сложилось");
  near(by.A.totalSeconds, 140);
  near(by.A.dailyTotalSeconds, 140);
  assert.ok(by.A.proportion > 0, "вес остался положительным (дальше его подстраивает само приложение)");
  near(sumT(ctx), 1, "сумма целей приложения");
  assert.equal(ctx.cardById(by.B.id), null, "карточка B убрана из DOM");
  assert.equal(ctx.elementOf(by.A, "target").value, String(by.A.targetProportion), "поле цели обновилось");
  ctx.close();
});

test("таймер + несколько сиблингов разом", () => {
  const { ctx, by } = world([["A", 0.4], ["B", 0.3], ["C", 0.2], ["D", 0.1]]);
  ctx.click(timerButton(ctx, by.B, "merge"));
  tick(ctx, "A", "D");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.deepEqual(names(ctx).sort(), ["B", "C"]);
  near(by.B.targetProportion, 0.8);
  near(sumT(ctx), 1);
  ctx.close();
});

test("таймер + группа-сиблинг: вливается всё содержимое группы на любой глубине", () => {
  const { ctx, by } = world([["A", 0.4], ["B", 0.2], ["C", 0.2], ["D", 0.2]]);
  const f = ctx.addFolder("Папка");
  const inner = ctx.addFolder("Вложенная", T(ctx).findNode(f.id).node);
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, inner.id);
  by.B.totalSeconds = 11;
  by.C.totalSeconds = 22;
  by.A.totalSeconds = 1;
  ctx.click(timerButton(ctx, by.A, "merge"));
  tick(ctx, "Папка");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.deepEqual(names(ctx).sort(), ["A", "D"]);
  near(by.A.targetProportion, 0.8, "A + B + C");
  near(by.A.totalSeconds, 34, "время всех влилось");
  assert.equal(T(ctx).allFolderNodes().length, 0, "обе группы исчезли");
  assert.equal(ctx.folderEl(f.id), null);
  near(sumT(ctx), 1);
  ctx.close();
});

test("слияние внутри группы не выходит за её пределы: сумма группы и всё снаружи прежние", () => {
  const { ctx, by } = world([["A", 0.4], ["B", 0.2], ["C", 0.2], ["D", 0.2]]);
  const f = ctx.addFolder("Папка");
  ["B", "C", "D"].forEach(n => ctx.moveToFolder(by[n].id, f.id));
  const before = T(ctx).folderTarget(f.id);
  ctx.click(timerButton(ctx, by.B, "merge"));
  tick(ctx, "C");
  ctx.click(byId(ctx, "mergeConfirm"));
  near(T(ctx).folderTarget(f.id), before, "сумма группы");
  near(by.A.targetProportion, 0.4, "корень не тронут");
  near(by.B.targetProportion, 0.4);
  assert.equal(T(ctx).parentOf(by.B.id).id, f.id);
  ctx.close();
});

test("идущий отсчёт: чужой останавливается и влит, свой продолжается", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  ctx.TimerController.toggleTracking(by.B.id);
  ctx.clock.advanceSec(120);
  ctx.tick();
  ctx.click(timerButton(ctx, by.A, "merge"));
  tick(ctx, "B");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.ok(by.A.trackedSeconds >= 119, `время B попало в A: ${by.A.trackedSeconds}`);
  assert.equal(by.A.isTracking, false, "A не запускался");
  ctx.clock.advanceSec(30);
  ctx.tick();
  assert.ok(by.A.trackedSeconds < 125, "после слияния ничего не тикает");
  ctx.close();
});

test("если считался сам таймер, отсчёт продолжается после слияния", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  ctx.TimerController.toggleTracking(by.A.id);
  ctx.clock.advanceSec(60);
  ctx.tick();
  ctx.click(timerButton(ctx, by.A, "merge"));
  tick(ctx, "B");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.equal(by.A.isTracking, true);
  const before = by.A.trackedSeconds;
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.ok(by.A.trackedSeconds > before + 55, "растёт дальше");
  ctx.close();
});

test("планы и рекомендации пересчитываются, в карточке нет NaN", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  ctx.click(timerButton(ctx, by.A, "merge"));
  tick(ctx, "B");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.ok(by.A.plannedSeconds > by.C.plannedSeconds, "план A вырос");
  assert.doesNotMatch(ctx.card(by.A).textContent, /NaN|undefined/);
  assert.match(ctx.cardText(by.A, "priority"), /Приоритет: \d/);
  ctx.close();
});

// =====================================================================
//  Группа
// =====================================================================

function openFolderMerge(ctx, folder) {
  ctx.click(folderButton(ctx, folder, "merge-folder"));
  assert.ok(modalOpen(ctx), "окно объединения группы открылось");
}
const setMode = (ctx, mode) => {
  const radio = qa(ctx, ".merge-mode").find(r => r.value === mode);
  radio.checked = true;
  ctx.change(radio);
};

test("окно группы: два пункта — «Объединить дочернее» и «Объединиться с сиблингами»", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Папка");
  openFolderMerge(ctx, f);
  const radios = qa(ctx, ".merge-mode");
  assert.deepEqual(radios.map(r => r.value), ["children", "siblings"]);
  assert.equal(radios[0].checked, true, "по умолчанию — дочернее");
  const section = byId(ctx, "mergeSiblings");
  assert.equal(section.classList.contains("hidden"), true, "выбор сиблингов скрыт");
  setMode(ctx, "siblings");
  assert.equal(section.classList.contains("hidden"), false, "показан");
  setMode(ctx, "children");
  assert.equal(section.classList.contains("hidden"), true);
  void by;
  ctx.close();
});

test("«Объединить дочернее»: группа становится одним таймером с её названием на её месте", () => {
  const { ctx, by } = world([["A", 0.4], ["B", 0.3], ["C", 0.3]]);
  const f = ctx.addFolder("Учёба");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  by.B.lifetimeTotalSeconds = 70;
  by.C.lifetimeTotalSeconds = 30;
  const rootBefore = ctx.rootOrder();
  openFolderMerge(ctx, f);
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.equal(modalOpen(ctx), false);
  assert.equal(T(ctx).allFolderNodes().length, 0, "группы больше нет");
  assert.deepEqual(names(ctx).sort(), ["A", "Учёба"]);
  const merged = ctx.AppState.getTimers().find(t => t.name === "Учёба");
  near(merged.targetProportion, 0.6, "цель = цель группы");
  near(merged.lifetimeTotalSeconds, 100, "время склеено");
  assert.equal(ctx.rootOrder().indexOf(merged.id), rootBefore.indexOf(f.id), "встал на место группы");
  assert.ok(ctx.card(merged), "у нового таймера есть карточка");
  assert.equal(ctx.cardById(by.B.id), null);
  near(sumT(ctx), 1);
  ctx.close();
});

test("«Объединить дочернее» у вложенной группы и у группы с подгруппами", () => {
  const { ctx, by } = world([["A", 0.4], ["B", 0.2], ["C", 0.2], ["D", 0.2]]);
  const outer = ctx.addFolder("Внешняя");
  const inner = ctx.addFolder("Внутренняя", T(ctx).findNode(outer.id).node);
  ctx.moveToFolder(by.B.id, outer.id);
  ctx.moveToFolder(by.C.id, inner.id);
  ctx.moveToFolder(by.D.id, inner.id);
  openFolderMerge(ctx, inner);
  ctx.click(byId(ctx, "mergeConfirm"));
  const innerTimer = ctx.AppState.getTimers().find(t => t.name === "Внутренняя");
  near(innerTimer.targetProportion, 0.4);
  assert.equal(T(ctx).parentOf(innerTimer.id).id, outer.id, "осталась в Внешней");
  openFolderMerge(ctx, outer);
  ctx.click(byId(ctx, "mergeConfirm"));
  const outerTimer = ctx.AppState.getTimers().find(t => t.name === "Внешняя");
  near(outerTimer.targetProportion, 0.6, "B + (C + D)");
  assert.deepEqual(names(ctx).sort(), ["A", "Внешняя"]);
  near(sumT(ctx), 1);
  ctx.close();
});

test("пустая группа превращается в таймер с целью 0", () => {
  const { ctx } = world([["A", 1]]);
  const f = ctx.addFolder("Пустая");
  openFolderMerge(ctx, f);
  ctx.click(byId(ctx, "mergeConfirm"));
  const t = ctx.AppState.getTimers().find(x => x.name === "Пустая");
  assert.ok(t);
  assert.equal(t.targetProportion, 0);
  near(sumT(ctx), 1);
  ctx.close();
});

test("«Объединиться с сиблингами»: нужно отметить сиблингов и назвать новый таймер", () => {
  const { ctx, by } = world([["A", 0.25], ["B", 0.25], ["C", 0.25], ["D", 0.25]]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.C.id, f.id);
  ctx.moveToFolder(by.D.id, f.id);
  openFolderMerge(ctx, f);
  setMode(ctx, "siblings");
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /Отметьте/);
  tick(ctx, "A");
  byId(ctx, "mergeName").value = "";
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /пустым/);
  byId(ctx, "mergeName").value = "b";
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.match(byId(ctx, "modalError").textContent, /уже занято/, "«B» — чужой таймер, который остаётся");
  assert.ok(modalOpen(ctx));
  byId(ctx, "mergeName").value = "Сводный";
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.equal(modalOpen(ctx), false);
  assert.deepEqual(names(ctx).sort(), ["B", "Сводный"]);
  const merged = ctx.AppState.getTimers().find(t => t.name === "Сводный");
  near(merged.targetProportion, 0.75, "A + C + D");
  assert.equal(T(ctx).allFolderNodes().length, 0);
  near(sumT(ctx), 1);
  ctx.close();
});

test("«Объединиться с сиблингами»: можно взять название объединяемой сущности — она исчезает", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.5]]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.B.id, f.id);
  openFolderMerge(ctx, f);
  setMode(ctx, "siblings");
  tick(ctx, "A");
  byId(ctx, "mergeName").value = "Папка";
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.equal(modalOpen(ctx), false);
  assert.deepEqual(names(ctx), ["Папка"]);
  near(ctx.AppState.getTimers()[0].targetProportion, 1);
  ctx.close();
});

test("объединение с сиблингом-группой: берутся и их таймеры", () => {
  const { ctx, by } = world([["A", 0.25], ["B", 0.25], ["C", 0.25], ["D", 0.25]]);
  const f1 = ctx.addFolder("Первая");
  const f2 = ctx.addFolder("Вторая");
  ctx.moveToFolder(by.A.id, f1.id);
  ctx.moveToFolder(by.B.id, f1.id);
  ctx.moveToFolder(by.C.id, f2.id);
  openFolderMerge(ctx, f1);
  setMode(ctx, "siblings");
  tick(ctx, "Вторая");
  byId(ctx, "mergeName").value = "Всё вместе";
  ctx.click(byId(ctx, "mergeConfirm"));
  assert.deepEqual(names(ctx).sort(), ["D", "Всё вместе"]);
  near(ctx.AppState.getTimers().find(t => t.name === "Всё вместе").targetProportion, 0.75);
  assert.equal(T(ctx).allFolderNodes().length, 0);
  ctx.close();
});

test("после слияния тик, облачный снимок и хранилище целы; дерево совпадает с DOM", () => {
  const { ctx, by } = world([["A", 0.3], ["B", 0.3], ["C", 0.4]]);
  const f = ctx.addFolder("Папка");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  openFolderMerge(ctx, f);
  ctx.click(byId(ctx, "mergeConfirm"));
  ctx.tick();
  ctx.StorageService.saveToLocalStorage();
  const stored = JSON.parse(ctx.window.localStorage.getItem("timers"));
  assert.equal(stored.length, 2);
  const dom = Array.from(ctx.document.querySelectorAll("#timersContainer .timer-container")).map(e => Number(e.id.slice(6)));
  assert.deepEqual(dom.sort(), ctx.flat().filter(x => x.kind === "timer").map(x => x.id).sort());
  ctx.close();
});

// =====================================================================
//  Расписание конструктора следует за слиянием
// =====================================================================

test("«Конструктор дня»: после слияния одна активность с суммарным временем", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.25], ["C", 0.25]]);
  const d0 = ctx.DayDraft.fromMain();
  const set = (name, s, e) => d0.setTime(d0.all().find(n => n.name === name).id, s, e);
  set("A", 0, 720);
  set("B", 720, 1080);
  set("C", 1080, 1440);
  assert.equal(d0.commit().ok, true);
  ctx.click(timerButton(ctx, by.B, "merge"));
  tick(ctx, "C");
  ctx.click(byId(ctx, "mergeConfirm"));
  const d = ctx.DayDraft.fromMain();
  const b = d.all().find(n => n.name === "B");
  assert.equal(d.duration(b), 720, "B + C = 12 часов");
  assert.equal(d.all().find(n => n.name === "C"), undefined);
  assert.equal(Array.from(d.analyze().errors).length, 0);
  ctx.close();
});

test("слияние группы в таймер сохраняет её позицию в порядке расписания", () => {
  const { ctx, by } = world([["A", 0.5], ["B", 0.25], ["C", 0.25]]);
  const f = ctx.addFolder("Блок");
  ctx.moveToFolder(by.B.id, f.id);
  ctx.moveToFolder(by.C.id, f.id);
  const d0 = ctx.DayDraft.fromMain();
  const node = n => d0.all().find(x => x.name === n);
  d0.setTime(node("Блок").id, 0, 720);
  d0.setTime(node("B").id, 0, 360);
  d0.setTime(node("C").id, 360, 720);
  d0.setTime(node("A").id, 720, 1440);
  assert.equal(d0.commit().ok, true);
  openFolderMerge(ctx, f);
  ctx.click(byId(ctx, "mergeConfirm"));
  const d = ctx.DayDraft.fromMain();
  const rows = Array.from(d.rows().map(r => r.node.name));
  assert.deepEqual(rows, ["Блок", "A"], "«Блок» по-прежнему первый");
  assert.equal(d.duration(d.all().find(n => n.name === "Блок")), 720);
  ctx.close();
});

// =====================================================================
//  Случайные слияния: инварианты
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

for (let seed = 1; seed <= Number(process.env.MERGE_SEEDS || 15); seed++) {
  test(`случайные слияния №${seed}: Σ целей = 1, время сохраняется, дерево и DOM согласованы`, () => {
    const rand = rng(seed * 313 + 5);
    const pick = list => list[Math.floor(rand() * list.length)];
    const n = 5 + Math.floor(rand() * 4);
    const specs = Array.from({ length: n }, (_, i) => [`T${i}`, 1 / n, {
      lifetimeTotalSeconds: 100 * (i + 1),
      totalSeconds: 100 * (i + 1),
    }]);
    const { ctx } = world(specs);
    const folders = [];
    for (let i = 0; i < 2; i++) {
      const parent = folders.length && rand() < 0.4 ? T(ctx).findNode(pick(folders).id).node : null;
      folders.push(ctx.addFolder(`F${i}`, parent));
    }
    ctx.AppState.getTimers().forEach(t => {
      if (rand() < 0.6) {
        const f = pick(folders);
        ctx.moveToFolder(t.id, f.id);
      }
    });
    const lifetime = totalOf(ctx, "lifetimeTotalSeconds");
    for (let step = 0; step < 6; step++) {
      const nodes = Array.from(T(ctx).flatten());
      if (nodes.length < 2) break;
      const node = pick(nodes);
      const sibs = Array.from(T(ctx).siblingsOf(node.id)).filter(x => Number(x.id) !== node.id);
      if (node.kind === "timer") {
        if (!sibs.length) continue;
        ctx.click(timerButton(ctx, { id: node.id }, "merge"));
        qa(ctx, ".merge-checkbox").forEach(cb => (cb.checked = rand() < 0.6));
        if (!qa(ctx, ".merge-checkbox:checked").length) qa(ctx, ".merge-checkbox")[0].checked = true;
      } else {
        ctx.click(folderButton(ctx, { id: node.id }, "merge-folder"));
        if (rand() < 0.5 && sibs.length) {
          setMode(ctx, "siblings");
          qa(ctx, ".merge-checkbox").forEach(cb => (cb.checked = rand() < 0.6));
          if (!qa(ctx, ".merge-checkbox:checked").length) qa(ctx, ".merge-checkbox")[0].checked = true;
          byId(ctx, "mergeName").value = `M${seed}_${step}`;
        }
      }
      ctx.click(byId(ctx, "mergeConfirm"));
      assert.equal(modalOpen(ctx), false, `шаг ${step}: окно закрылось (${byId(ctx, "modalError") && byId(ctx, "modalError").textContent})`);
      near(sumT(ctx), 1, `шаг ${step}: Σ целей`, 1e-7);
      near(totalOf(ctx, "lifetimeTotalSeconds"), lifetime, `шаг ${step}: время не потеряно`, 1e-6);
      const treeTimers = ctx.flat().filter(x => x.kind === "timer").map(x => x.id).sort();
      const model = ctx.AppState.getTimers().map(t => t.id).sort();
      assert.deepEqual(treeTimers, model, `шаг ${step}: дерево = модель`);
      const dom = Array.from(ctx.document.querySelectorAll("#timersContainer .timer-container")).map(e => Number(e.id.slice(6))).sort();
      assert.deepEqual(dom, model, `шаг ${step}: DOM = модель`);
      const allNames = ctx.NameRules.entities().map(e => ctx.NameRules.key(e.name));
      assert.equal(new Set(allNames).size, allNames.length, `шаг ${step}: названия различны`);
    }
    ctx.close();
  });
}
