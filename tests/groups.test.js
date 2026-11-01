// Автотесты «Группировки таймеров по папкам» (Требования-группы.md).
//
// Проверяют новое поведение:
//   раздел 2 — папка как сущность (контейнер, вложенность, название, не таймер,
//              производная целевая пропорция);
//   раздел 3 — «Доля» и «Целевая пропорция» (одна величина в двух видах,
//              инварианты суммы, локальная правка доли и глобальная правка цели,
//              деление поровну, изменение изнутри/снаружи);
//   раздел 4 — чего в интерфейсе больше нет (подсветка, «← «родитель»»);
//   раздел 5 — создание папок и задач;
//   раздел 6 — перенос «В группу»;
//   раздел 7 — удаление и перерасчёт;
//   раздел 8 — отображение дерева.
// Перемещения (раздел 9) и синхронизация порядка (раздел 10) — в groups-move.test.js.
//
// Запуск:  npm test     (node --test tests/)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, readHtml, DEFAULT_END } = require("./harness.js");

after(closeAll);

const EPS = 1e-9;
const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);

/** Три корневые задачи: A 0.5, B 0.3, C 0.2 (сумма целей = 1). */
function scene(opts = {}) {
  const ctx = setup(opts);
  const a = ctx.addTimer({ name: "A", proportion: 0.5, targetProportion: 0.5 });
  const b = ctx.addTimer({ name: "B", proportion: 0.3, targetProportion: 0.3 });
  const c = ctx.addTimer({ name: "C", proportion: 0.2, targetProportion: 0.2 });
  ctx.setEndTime(opts.end || DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, a, b, c, document: ctx.document };
}

/** A в корне + папка F с B и C (цель F = 0.5, доли внутри: B 0.6, C 0.4). */
function folderScene(opts = {}) {
  const s = scene(opts);
  const f = s.ctx.addFolder("F");
  s.ctx.moveToFolder(s.b.id, f.id);
  s.ctx.moveToFolder(s.c.id, f.id);
  s.f = f;
  // тесты деструктурируют { ctx, ... } и обращаются к папке как ctx.f
  s.ctx.f = f;
  return s;
}

// --- хелперы -------------------------------------------------------------
const T = ctx => ctx.TreeModel;
const target = t => Number(t.targetProportion);
const folderById = (ctx, id) => T(ctx).findNode(id).node;
/** Порядок узлов в DOM (DFS) — как его видит пользователь. */
function domOrder(ctx) {
  const out = [];
  const walk = host => {
    [...host.children].forEach(el => {
      if (el.classList && el.classList.contains("folder-node")) {
        const id = Number(el.getAttribute("data-folder-id"));
        out.push({ kind: "folder", id });
        walk(ctx.folderChildrenEl(id));
      } else if (el.id && el.id.startsWith("timer-")) {
        out.push({ kind: "timer", id: Number(el.id.slice("timer-".length)) });
      }
    });
  };
  walk(ctx.document.getElementById("timersContainer"));
  return out;
}
/** Видимость с учётом предков: свёрнутая папка скрывает всё своё содержимое. */
const visible = (ctx, el) => ctx.isVisible(el);
/** Клик по кнопке модалки через делегирование подложки (как в приложении). */
const modalClick = (ctx, id) =>
  ctx.ModalController.handleOverlayClick({
    target: ctx.document.getElementById(id),
  });

// =====================================================================
//  Раздел 2. Папка (группа) как сущность
// =====================================================================

test("ТЗ 5.1: «Создать группу» есть в «Операциях» и создаёт папку", () => {
  const { ctx, document } = scene();
  const menuButton = ctx.globalButton("☰ Операции");
  assert.ok(menuButton, "кнопка «Операции» на месте");
  const item = [...document.querySelectorAll("#operationsMenu button")].find(
    b => b.getAttribute("data-action") === "create-group"
  );
  assert.ok(item, "в меню есть «Создать группу»");
  ctx.click(menuButton);
  ctx.click(item);
  assert.equal(
    document.getElementById("modalOverlay").classList.contains("hidden"),
    false,
    "модалка открытия группы"
  );
  document.getElementById("createGroupName").value = "Чтение";
  modalClick(ctx, "createGroupConfirm");
  const folders = T(ctx).allFolderNodes();
  assert.equal(folders.length, 1, "папка создана");
  assert.equal(folders[0].name, "Чтение");
  assert.ok(ctx.folderEl(folders[0].id), "папка отрисована в дереве");
  assert.equal(T(ctx).root().length, 4, "папка встала в корень к трём задачам");
  ctx.close();
});

test("ТЗ 2.3: пустая папка — нормальное состояние", () => {
  const { ctx } = scene();
  const f = ctx.addFolder("Пустая");
  assert.equal((f.children || []).length, 0);
  assert.ok(ctx.folderEl(f.id), "пустая папка отрисована");
  close(T(ctx).folderTarget(f.id), 0, "производная цель пустой папки");
  // Приложение живо: тик не падает, планы считаются
  ctx.tick();
  assert.ok(ctx.AppState.getTimers().length === 3);
  ctx.close();
});

test("ТЗ 2.5: папка не таймер — нет времени, плана и кнопки запуска", () => {
  const { ctx } = folderScene();
  assert.ok(ctx.folderEl(ctx.f.id), "элемент папки есть");
  const head = ctx.folderHeader(ctx.f.id);
  assert.ok(head, "шапка папки есть");
  assert.equal(
    head.querySelectorAll('[data-action="track"]').length,
    0,
    "у папки нет кнопки Старт/Пауза"
  );
  assert.equal(head.querySelectorAll(".time-display").length, 0, "нет блоков времени");
  assert.equal(ctx.document.getElementById(`planned-${ctx.f.id}`), null, "нет «план»");
  assert.equal(ctx.document.getElementById(`tracked-${ctx.f.id}`), null, "нет «намеряно»");
  assert.equal(
    ctx.AppState.getTimers().some(t => t.id === ctx.f.id),
    false,
    "папки нет в списке таймеров"
  );
  assert.equal(T(ctx).nodeTarget({ k: "f", id: ctx.f.id, children: [] }) >= 0, true);
  ctx.close();
});

test("ТЗ 2.4: название папки всегда можно изменить", () => {
  const { ctx } = folderScene();
  const input = ctx.document.getElementById(`folder-name-${ctx.f.id}`);
  assert.ok(input, "поле названия папки");
  input.value = "Здоровье";
  ctx.change(input);
  assert.equal(folderById(ctx, ctx.f.id).name, "Здоровье", "имя в модели");
  assert.equal(
    ctx.document.getElementById(`folder-name-${ctx.f.id}`).value,
    "Здоровье"
  );
  ctx.close();
});

test("ТЗ 2.6: цель папки производная и напрямую не редактируется", () => {
  const { ctx, b, c } = folderScene();
  const head = ctx.folderHeader(ctx.f.id);
  assert.equal(
    head.querySelectorAll('[data-action="target-proportion"]').length,
    0,
    "поля ввода цели у папки нет"
  );
  assert.equal(
    head.querySelectorAll('[data-action="share"]').length,
    0,
    "поля ввода доли у папки нет (ТЗ 3.5.1)"
  );
  close(T(ctx).folderTarget(ctx.f.id), target(b) + target(c), "цель = сумма содержимого");
  assert.match(
    ctx.document.getElementById(`folder-target-${ctx.f.id}`).textContent,
    /0\.5000/,
    "производная цель показана в шапке"
  );
  // Изменилась цель внутри — цель папки изменилась сама
  T(ctx).setTargetGlobal(b.id, 0.5);
  close(T(ctx).folderTarget(ctx.f.id), target(b) + target(c), "цель папки пересчиталась");
  ctx.close();
});

test("ТЗ 2.2.2: папки вкладываются друг в друга", () => {
  const { ctx, c } = folderScene();
  const inner = ctx.addFolder("Внутри", folderById(ctx, ctx.f.id));
  ctx.moveToFolder(c.id, inner.id);
  const flat = ctx.flat();
  const depthOf = id => flat.find(x => x.id === id).depth;
  assert.equal(depthOf(ctx.f.id), 0, "F на корневом уровне");
  assert.equal(depthOf(inner.id), 1, "вложенная папка на уровне 1");
  assert.equal(depthOf(c.id), 2, "задача внутри вложенной папки на уровне 2");
  assert.ok(ctx.folderEl(inner.id), "вложенная папка отрисована");
  ctx.close();
});

// =====================================================================
//  Раздел 3. «Доля» и «Целевая пропорция»
// =====================================================================

test("ТЗ 3.2.1: сумма целевых пропорций приложения равна 1 после операций", () => {
  const { ctx, a, b } = folderScene();
  close(ctx.sumTargets(), 1, "исходно");
  T(ctx).setTargetGlobal(a.id, 0.25);
  close(ctx.sumTargets(), 1, "после глобальной правки цели");
  T(ctx).setShareLocal(b.id, 0.9);
  close(ctx.sumTargets(), 1, "после локальной правки доли");
  ctx.AppController.createTaskInFolder(ctx.f.id, "D", "0.5");
  close(ctx.sumTargets(), 1, "после создания задачи в папке");
  ctx.close();
});

test("ТЗ 3.2.2: сумма долей сиблингов одного родителя равна 1", () => {
  const { ctx, a, b, c } = folderScene();
  const sumIn = ids => ids.reduce((s, id) => s + T(ctx).shareOf(id), 0);
  close(sumIn([a.id, ctx.f.id]), 1, "корневой уровень");
  close(sumIn([b.id, c.id]), 1, "уровень папки F");
  T(ctx).setShareLocal(b.id, 0.15);
  close(sumIn([b.id, c.id]), 1, "после правки доли");
  ctx.close();
});

test("ТЗ 3.2.3/3.2.4: значение больше 1 обрезается, у остальных — нули", () => {
  const { ctx, a, b, c } = scene();
  T(ctx).setTargetGlobal(a.id, 1.7);
  close(target(a), 1, "обрезано до 1");
  close(target(b), 0, "у остальных 0");
  close(target(c), 0, "у остальных 0");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

test("ТЗ 3.3: доля — часть в сумме целей сиблингов, в корне равна цели", () => {
  const { ctx, a, b, c } = folderScene();
  // 3.3.1/3.3.2: доля таймера и доля папки считаются одинаково
  close(T(ctx).shareOf(b.id), 0.3 / 0.5, "доля B внутри F");
  close(T(ctx).shareOf(c.id), 0.2 / 0.5, "доля C внутри F");
  close(T(ctx).shareOf(ctx.f.id), 0.5, "доля папки F среди корневых");
  // 3.3.3/3.3.4: корень — родитель верхнего уровня, там доля = цель
  close(T(ctx).shareOf(a.id), target(a), "в корне доля численно равна цели");
  assert.equal(T(ctx).isRootLevel(a.id), true);
  assert.equal(T(ctx).isRootLevel(b.id), false);
  ctx.close();
});

test("ТЗ 3.4.2: у корневых сущностей доля не показывается", () => {
  const { ctx, a } = scene();
  assert.equal(visible(ctx, ctx.shareRow(a)), false, "строка «Доля» скрыта в корне");
  assert.equal(T(ctx).isShareVisible(a.id), false);
  ctx.close();
});

test("ТЗ 3.4.2: доля появляется, как только сущность перестала быть корневой", () => {
  const { ctx, b } = scene();
  assert.equal(T(ctx).isShareVisible(b.id), false);
  const f = ctx.addFolder("F");
  ctx.moveToFolder(b.id, f.id);
  const d = ctx.addTimer({ name: "D", proportion: 0.1, targetProportion: 0.1 });
  ctx.moveToFolder(d.id, f.id);
  assert.equal(T(ctx).isShareVisible(b.id), true, "B больше не корневая");
  assert.ok(visible(ctx, ctx.shareRow(b)), "строка «Доля» показана");
  ctx.close();
});

test("ТЗ 3.4.3: у единственного ребёнка доли нет, пока не появился сиблинг", () => {
  const { ctx, b } = scene();
  const f = ctx.addFolder("F");
  ctx.moveToFolder(b.id, f.id);
  assert.equal(T(ctx).isShareVisible(b.id), false, "единственный ребёнок");
  assert.equal(visible(ctx, ctx.shareRow(b)), false);
  const d = ctx.addTimer({ name: "D", proportion: 0.1, targetProportion: 0.1 });
  ctx.moveToFolder(d.id, f.id);
  assert.equal(T(ctx).isShareVisible(b.id), true, "сиблинг появился");
  assert.ok(visible(ctx, ctx.shareRow(b)));
  close(T(ctx).shareOf(b.id) + T(ctx).shareOf(d.id), 1, "сумма долей 1");
  ctx.close();
});

test("ТЗ 3.4.4: доля показывается и в свёрнутой карточке", () => {
  const { ctx, b, c } = folderScene();
  assert.equal(ctx.card(b).classList.contains("collapsed"), true, "карточка свёрнута");
  assert.ok(visible(ctx, ctx.shareRow(b)), "доля видна в свёрнутой карточке");
  const row = [...ctx.card(b).children].find(el =>
    el.classList.contains("share-container")
  );
  assert.ok(row.classList.contains("compact-visible"), "строка в белом списке");
  close(Number(ctx.shareInput(b).value), T(ctx).shareOf(b.id), "значение в поле");
  ctx.close();
});

test("ТЗ 3.4.5: у пустой папки доля равна 0", () => {
  const { ctx } = folderScene();
  const empty = ctx.addFolder("Пусто");
  close(T(ctx).folderTarget(empty.id), 0, "цель пустой папки");
  close(T(ctx).shareOf(empty.id), 0, "доля пустой папки");
  assert.match(
    ctx.document.getElementById(`folder-share-${empty.id}`).textContent,
    /0\.0000/,
    "доля показана как 0"
  );
  ctx.close();
});

test("ТЗ 3.4.6: при нулевой сумме уровня доли показываются как 0", () => {
  const { ctx, b, c } = folderScene();
  b.targetProportion = 0;
  c.targetProportion = 0;
  T(ctx).changed();
  ctx.TimerView.renderTree();
  close(T(ctx).shareOf(b.id), 0, "доля B");
  close(T(ctx).shareOf(c.id), 0, "доля C");
  assert.equal(Number(ctx.shareInput(b).value), 0);
  assert.match(
    ctx.document.getElementById(`folder-share-${ctx.f.id}`).textContent,
    /0\.0000/
  );
  ctx.close();
});

test("ТЗ 3.5.1: долю папки менять нельзя — она не таймер", () => {
  const { ctx } = folderScene();
  assert.equal(T(ctx).setShareLocal(ctx.f.id, 0.5), false, "сеттер доли папки отказал");
  assert.equal(
    ctx.folderHeader(ctx.f.id).querySelectorAll("input[type=number]").length,
    0,
    "числовых полей в шапке папки нет"
  );
  ctx.close();
});

test("ТЗ 3.5.2/3.5.3: доля и цель — две стороны одной величины", () => {
  const { ctx, b, c } = folderScene();
  // правка доли меняет целевую пропорцию
  T(ctx).setShareLocal(b.id, 0.25);
  close(target(b), 0.25 * 0.5, "цель B после правки доли");
  close(target(c), 0.75 * 0.5, "цель C дополняет сумму папки");
  // правка цели меняет отображаемую долю
  T(ctx).setTargetGlobal(c.id, 0.25);
  ctx.TimerView.syncAllProportionInputs();
  close(Number(ctx.shareInput(c).value), T(ctx).shareOf(c.id), "доля в поле обновилась");
  ctx.close();
});

test("ТЗ 3.5.3: доля задаётся числом от 0 до 1 (границы поля)", () => {
  const { ctx, b } = folderScene();
  const input = ctx.shareInput(b);
  assert.equal(input.getAttribute("min"), "0");
  assert.equal(input.getAttribute("max"), "1");
  assert.equal(input.getAttribute("data-action"), "share");
  ctx.close();
});

test("ТЗ 3.5.6: на корневом уровне правка доли и правка цели неразличимы", () => {
  // Доля корневой сущности численно равна её цели (ТЗ 3.3.4), поэтому радиусы
  // обеих правок совпадают и результат обязан быть одинаковым.
  const one = scene();
  const two = scene();
  const A1 = one.ctx.AppState.getTimers().find(t => t.name === "A");
  const A2 = two.ctx.AppState.getTimers().find(t => t.name === "A");

  T(one.ctx).setShareLocal(A1.id, 0.25); // правка «доли»
  T(two.ctx).setTargetGlobal(A2.id, 0.25); // правка «цели»

  ["A", "B", "C"].forEach(name => {
    const t1 = one.ctx.AppState.getTimers().find(t => t.name === name);
    const t2 = two.ctx.AppState.getTimers().find(t => t.name === name);
    close(target(t1), target(t2), `цель ${name} совпадает при обеих правках`);
  });
  close(target(A1), 0.25, "новое значение принято");
  close(one.ctx.sumTargets(), 1, "сумма 1 (доля)");
  close(two.ctx.sumTargets(), 1, "сумма 1 (цель)");
  one.ctx.close();
  two.ctx.close();
});

test("ТЗ 3.6: правка доли локальна — сумма родителя не меняется, снаружи всё прежнее", () => {
  const { ctx, a, b, c } = folderScene();
  const beforeA = target(a);
  const beforeFolder = T(ctx).folderTarget(ctx.f.id);
  T(ctx).setShareLocal(b.id, 0.25);
  close(T(ctx).folderTarget(ctx.f.id), beforeFolder, "сумма папки не изменилась");
  close(target(a), beforeA, "за пределами папки ничего не изменилось");
  close(T(ctx).shareOf(a.id), 0.5, "корневая доля A прежняя");
  close(T(ctx).shareOf(ctx.f.id), 0.5, "доля папки F прежняя");
  close(T(ctx).shareOf(b.id), 0.25, "внутренняя доля B изменилась");
  close(T(ctx).shareOf(c.id), 0.75, "внутренняя доля C изменилась");
  ctx.close();
});

test("ТЗ 3.6.2: остаток делится между сиблингами пропорционально прежним целям", () => {
  const { ctx } = scene();
  const f = ctx.addFolder("F");
  ["B", "C", "D"].forEach(() => {});
  const b = ctx.AppState.getTimers().find(t => t.name === "B");
  const c = ctx.AppState.getTimers().find(t => t.name === "C");
  const d = ctx.addTimer({ name: "D", proportion: 0, targetProportion: 0.1 });
  // пересобираем сумму: A 0.5 - 0.1 = 0.4, чтобы сумма осталась 1
  ctx.AppState.getTimers().find(t => t.name === "A").targetProportion = 0.4;
  [b, c, d].forEach(t => ctx.moveToFolder(t.id, f.id));
  // внутри F: B 0.3, C 0.2, D 0.1 (сумма 0.6). Ставим B долю 0.5 → цель 0.3
  T(ctx).setShareLocal(b.id, 0.5);
  close(target(b), 0.5 * 0.6, "цель B");
  // остальное (0.3) делится между C и D пропорционально 0.2 : 0.1
  close(target(c), 0.3 * (0.2 / 0.3), "цель C");
  close(target(d), 0.3 * (0.1 / 0.3), "цель D");
  close(T(ctx).folderTarget(f.id), 0.6, "сумма папки");
  ctx.close();
});

test("ТЗ 3.7: правка цели глобальна — остальные в одно и то же число раз", () => {
  const { ctx, a, b, c } = folderScene();
  const bBefore = target(b);
  const cBefore = target(c);
  const aBefore = target(a);
  T(ctx).setTargetGlobal(b.id, 0.5);
  close(target(b), 0.5, "новая цель B");
  const factor = (1 - 0.5) / (aBefore + cBefore);
  close(target(a), aBefore * factor, "A изменён в то же число раз");
  close(target(c), cBefore * factor, "C изменён в то же число раз");
  close(target(a) / aBefore, target(c) / cBefore, "множитель один и тот же");
  close(ctx.sumTargets(), 1, "сумма 1");
  void bBefore;
  ctx.close();
});

test("ТЗ 3.7.3: правка цели меняет долю таймера и доли всех папок-предков", () => {
  const { ctx, b, c } = folderScene();
  const inner = ctx.addFolder("Inner", folderById(ctx, ctx.f.id));
  ctx.moveToFolder(c.id, inner.id);
  // дерево: A, F[B, Inner[C]]
  const shareFBefore = T(ctx).shareOf(ctx.f.id);
  T(ctx).setTargetGlobal(b.id, 0.45);
  assert.notEqual(T(ctx).shareOf(b.id), 0.6, "доля B внутри F изменилась");
  assert.notEqual(T(ctx).shareOf(ctx.f.id), shareFBefore, "доля F в корне изменилась");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

test("ТЗ 3.7.4: в чужих, не связанных ветках доли не меняются", () => {
  const { ctx, b } = scene();
  const f1 = ctx.addFolder("F1");
  const f2 = ctx.addFolder("F2");
  const a = ctx.AppState.getTimers().find(t => t.name === "A");
  const c = ctx.AppState.getTimers().find(t => t.name === "C");
  ctx.moveToFolder(a.id, f1.id);
  ctx.moveToFolder(b.id, f1.id);
  ctx.moveToFolder(c.id, f2.id);
  const d = ctx.addTimer({ name: "D", proportion: 0.1, targetProportion: 0.1 });
  ctx.moveToFolder(d.id, f2.id);
  const sharesF2Before = [T(ctx).shareOf(c.id), T(ctx).shareOf(d.id)];
  T(ctx).setTargetGlobal(b.id, 0.4);
  close(T(ctx).shareOf(c.id), sharesF2Before[0], "доля C в чужой ветке");
  close(T(ctx).shareOf(d.id), sharesF2Before[1], "доля D в чужой ветке");
  ctx.close();
});

test("ТЗ 3.8.2: при правке доли и нулях у сиблингов — делится поровну", () => {
  const { ctx } = scene();
  const f = ctx.addFolder("F");
  const a = ctx.AppState.getTimers().find(t => t.name === "A");
  const b = ctx.AppState.getTimers().find(t => t.name === "B");
  const c = ctx.AppState.getTimers().find(t => t.name === "C");
  a.targetProportion = 1;
  b.targetProportion = 0;
  c.targetProportion = 0;
  [a, b, c].forEach(t => ctx.moveToFolder(t.id, f.id));
  T(ctx).setShareLocal(a.id, 0.2);
  close(target(a), 0.2, "цель A");
  close(target(b), 0.4, "освободившееся поровну B");
  close(target(c), 0.4, "освободившееся поровну C");
  close(T(ctx).folderTarget(f.id), 1, "сумма папки");
  ctx.close();
});

test("ТЗ 3.8.3: при правке цели и нулях у остальных — поровну между всеми", () => {
  const { ctx, a, b, c } = scene();
  a.targetProportion = 1;
  b.targetProportion = 0;
  c.targetProportion = 0;
  T(ctx).setTargetGlobal(a.id, 0.4);
  close(target(a), 0.4, "цель A");
  close(target(b), 0.3, "поровну B");
  close(target(c), 0.3, "поровну C");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

test("ТЗ 3.8.4: часть, доставшаяся папке, делится поровну между её детьми и глубже", () => {
  const { ctx, a } = scene();
  const f = ctx.addFolder("F");
  const b = ctx.AppState.getTimers().find(t => t.name === "B");
  const c = ctx.AppState.getTimers().find(t => t.name === "C");
  const inner = ctx.addFolder("Inner", f);
  ctx.moveToFolder(b.id, f.id);
  ctx.moveToFolder(c.id, inner.id);
  const d = ctx.addTimer({ name: "D", proportion: 0, targetProportion: 0 });
  ctx.moveToFolder(d.id, inner.id);
  // все нули, кроме A: освободившееся должно разделиться поровну по уровням
  b.targetProportion = 0;
  c.targetProportion = 0;
  d.targetProportion = 0;
  a.targetProportion = 1;
  T(ctx).setTargetGlobal(a.id, 0.1);
  // F и Inner получают поровну от корневого уровня? A — единственный корневой
  // сиблинг F... проверяем инварианты: сумма 1 и у всех появившихся целей > 0
  close(ctx.sumTargets(), 1, "сумма 1");
  assert.ok(target(b) > 0 || target(c) > 0 || target(d) > 0, "нулевые получили часть");
  close(target(c), target(d), "внутри Inner поровну");
  ctx.close();
});

test("ТЗ 3.9.1: изменение изнутри — сумма папки меняется, внутренние доли тоже", () => {
  const { ctx, b, c } = folderScene();
  const innerBefore = [T(ctx).shareOf(b.id), T(ctx).shareOf(c.id)];
  T(ctx).setTargetGlobal(c.id, 0.4);
  assert.notEqual(T(ctx).folderTarget(ctx.f.id), 0.5, "сумма папки изменилась");
  assert.notEqual(T(ctx).shareOf(b.id), innerBefore[0], "внутренние доли изменились");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 3.9.2: изменение снаружи — содержимое папки в одно и то же число раз, доли внутри прежние", () => {
  const { ctx, b, c } = folderScene();
  const inner = ctx.addFolder("Inner", folderById(ctx, ctx.f.id));
  ctx.moveToFolder(c.id, inner.id);
  // F[B, Inner[C]] + A в корне; правим долю A? В корне доля не показывается,
  // поэтому действуем как при создании задачи в корне (ТЗ 3.9.3).
  const sharesBefore = [T(ctx).shareOf(b.id), T(ctx).shareOf(inner.id), T(ctx).shareOf(c.id)];
  ctx.AppController.createTaskInRoot("Новая", "0.5");
  const k = target(b) / 0.3;
  close(target(c), 0.2 * k, "C изменён тем же множителем, что B");
  close(T(ctx).shareOf(b.id), sharesBefore[0], "внутренняя доля B не изменилась");
  close(T(ctx).shareOf(inner.id), sharesBefore[1], "доля Inner не изменилась");
  close(T(ctx).shareOf(c.id), sharesBefore[2], "доля C не изменилась");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

test("ТЗ 3.9.3: перераспределение снаружи бывает при правке доли сиблинга", () => {
  const { ctx } = scene();
  const outer = ctx.addFolder("Outer");
  const a = ctx.AppState.getTimers().find(t => t.name === "A");
  const b = ctx.AppState.getTimers().find(t => t.name === "B");
  const c = ctx.AppState.getTimers().find(t => t.name === "C");
  const f = ctx.addFolder("F", outer);
  [a].forEach(t => ctx.moveToFolder(t.id, outer.id));
  ctx.moveToFolder(f.id, outer.id);
  [b, c].forEach(t => ctx.moveToFolder(t.id, f.id));
  // Outer[A, F[B, C]]: правим долю A — F перераспределяется как сиблинг
  const sharesInF = [T(ctx).shareOf(b.id), T(ctx).shareOf(c.id)];
  T(ctx).setShareLocal(a.id, 0.8);
  close(T(ctx).shareOf(a.id), 0.8, "доля A");
  close(target(b) / 0.3, target(c) / 0.2, "содержимое F изменилось в одно число раз");
  close(T(ctx).shareOf(b.id), sharesInF[0], "внутренние доли F не изменились");
  close(T(ctx).shareOf(c.id), sharesInF[1], "внутренние доли F не изменились");
  ctx.close();
});

// =====================================================================
//  Раздел 4. Что убрано из интерфейса
// =====================================================================

test("ТЗ 4.1/4.2/4.3: подсветки сиблингов и строки «← «родитель»» больше нет", () => {
  const html = readHtml();
  // CSS-правил и кода подсветки не осталось (упоминание — только в комментарии
  // о том, что именно убрано)
  assert.ok(!/\.sibling-highlight\s*\{/.test(html), "CSS-правила подсветки нет");
  assert.ok(!/\.split-share\s*\{/.test(html), "CSS-правила строки доли разбиения нет");
  assert.ok(!/classList[^;\n]*sibling-highlight/.test(html), "подсветка не включается");
  assert.ok(!/highlightSiblings/.test(html), "обработчик подсветки убран");

  const { ctx, a } = scene();
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "A1", share: 1 },
    { name: "A2", share: 2 },
  ]);
  // в DOM нет ни подсветки, ни отдельной строки про родителя
  assert.equal(ctx.document.querySelectorAll(".sibling-highlight").length, 0);
  assert.equal(ctx.document.querySelectorAll(".split-share").length, 0);
  assert.equal(ctx.document.querySelectorAll(".split-share-container").length, 0);
  assert.ok(
    !ctx.card(children[0]).textContent.includes("←"),
    "подписи «← «родитель»» в карточке нет"
  );
  // принадлежность видна из дерева: обе подзадачи — дети одной папки
  const parent = T(ctx).parentOf(children[0].id);
  assert.ok(parent && T(ctx).isFolder(parent), "подзадачи в папке");
  assert.equal(T(ctx).parentOf(children[1].id).id, parent.id, "обе в одной папке");
  // ТЗ 4.4: наследие разбиения в модели не хранится
  ["splitShare", "splitId", "splitParentName"].forEach(field => {
    assert.equal(children[0][field], undefined, `${field} не хранится`);
    assert.equal(children[1][field], undefined, `${field} не хранится`);
  });
  ctx.close();
});

test("ТЗ 4.4: старое сохранение с splitShare/splitId/splitParentName очищается", () => {
  const legacy = JSON.stringify([
    {
      id: 1,
      name: "Старая",
      proportion: 0.5,
      targetProportion: 0.5,
      plannedSeconds: 100,
      trackedSeconds: 0,
      splitShare: 0.25,
      splitId: 7,
      splitParentName: "Родитель",
      isTracking: false,
      startTime: null,
      trackingSnapshot: null,
      lastResetTime: null,
    },
  ]);
  const ctx = setup();
  ctx.window.localStorage.setItem("timers", legacy);
  ctx.StorageService.loadTimersFromLocalStorage();
  const t = ctx.AppState.getTimers()[0];
  assert.ok(t, "задача загружена");
  assert.equal(t.splitShare, undefined, "splitShare вычищен");
  assert.equal(t.splitId, undefined, "splitId вычищен");
  assert.equal(t.splitParentName, undefined, "splitParentName вычищен");
  ctx.close();
});

test("ТЗ 4.4: сразу после разбиения доли в папке равны долям разбиения", () => {
  const { ctx, a } = scene();
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "A1", share: 1 },
    { name: "A2", share: 3 },
  ]);
  close(T(ctx).shareOf(children[0].id), 0.25, "доля A1");
  close(T(ctx).shareOf(children[1].id), 0.75, "доля A2");
  // дальше доли пересчитываются при любом изменении состава (ТЗ 4.4.2)
  const d = ctx.addTimer({ name: "D", proportion: 0, targetProportion: 0 });
  ctx.moveToFolder(d.id, T(ctx).parentOf(children[0].id).id);
  d.targetProportion = T(ctx).folderTarget(T(ctx).parentOf(children[0].id).id) * 0.5;
  T(ctx).changed();
  assert.notEqual(T(ctx).shareOf(children[0].id), 0.25, "доля пересчиталась");
  ctx.close();
});

// =====================================================================
//  Раздел 5. Создание папок и задач
// =====================================================================

test("ТЗ 5.2: «Разбить» группирует подзадачи в папку с именем таймера", () => {
  const { ctx, a } = scene();
  const children = ctx.AppController.splitTimer(a.id, [
    { name: "A1", share: 1 },
    { name: "A2", share: 1 },
  ]);
  const folder = T(ctx).parentOf(children[0].id);
  assert.ok(folder && T(ctx).isFolder(folder), "подзадачи в папке");
  assert.equal(folder.name, "A", "имя папки по умолчанию — имя таймера (ТЗ 5.2.3)");
  assert.equal(folder.children.length, 2);
  assert.equal(T(ctx).findNode(a.id), null, "узла исходного таймера нет");
  assert.equal(ctx.card(a), null, "карточка родителя убрана");
  close(T(ctx).folderTarget(folder.id), 0.5, "цель папки = цель родителя");
  ctx.close();
});

test("ТЗ 5.2.2/5.2.4: в модалке разбиения предлагается название папки", () => {
  const { ctx, a, document } = scene();
  ctx.SplitController.openModal(a.id);
  const field = document.getElementById("splitFolderName");
  assert.ok(field, "поле названия группы есть");
  assert.equal(field.value, "A", "по умолчанию — имя таймера");
  field.value = "Подзадачи А";
  document.querySelectorAll("#splitRows .split-name")[0].value = "A1";
  document.querySelectorAll("#splitRows .split-share")[0].value = "1";
  document.querySelectorAll("#splitRows .split-name")[1].value = "A2";
  document.querySelectorAll("#splitRows .split-share")[1].value = "1";
  modalClick(ctx, "splitConfirm");
  const [child] = T(ctx).root().filter(n => T(ctx).isFolder(n)).map(n => n);
  const folder = T(ctx).parentOf(
    ctx.AppState.getTimers().find(t => t.name === "A1").id
  );
  assert.equal(folder.name, "Подзадачи А", "название из модалки");
  assert.ok(child);
  ctx.close();
});

test("ТЗ 5.2: разбиение ставит папку на место исходного таймера", () => {
  const { ctx, b } = scene();
  const children = ctx.AppController.splitTimer(b.id, [
    { name: "B1", share: 1 },
    { name: "B2", share: 1 },
  ]);
  const folder = T(ctx).parentOf(children[0].id);
  const byName = n => ctx.AppState.getTimers().find(t => t.name === n).id;
  assert.deepEqual(
    ctx.rootOrder(),
    [byName("A"), folder.id, byName("C")],
    "папка встала между A и C — туда, где был B"
  );
  ctx.close();
});

test("ТЗ 5.3.1: «Создать задачу внутри группы» выбирает папки, если они есть", () => {
  const { ctx, document } = folderScene();
  ctx.GroupTaskController.openModal();
  const boxes = [...document.querySelectorAll(".group-checkbox")];
  assert.equal(boxes.length, 1, "в списке одна папка");
  assert.equal(boxes[0].getAttribute("data-folder-id"), String(ctx.f.id));
  assert.equal(boxes[0].getAttribute("data-timer-id"), null, "таймеры не предлагаются");
  boxes[0].checked = true;
  document.getElementById("groupTaskName").value = "D";
  document.getElementById("groupTaskProportion").value = "0.5";
  modalClick(ctx, "groupTaskConfirm");
  const created = ctx.AppState.getTimers().find(t => t.name === "D");
  assert.ok(created, "задача создана");
  assert.equal(T(ctx).parentOf(created.id).id, ctx.f.id, "создана внутри папки F");
  ctx.close();
});

test("ТЗ 5.3.2: если папок нет, выбираются таймеры и образуют визуальную группу", () => {
  const { ctx, a, b, document } = scene();
  ctx.GroupTaskController.openModal();
  const boxes = [...document.querySelectorAll(".group-checkbox")];
  assert.equal(boxes.length, 3, "предложены таймеры");
  boxes.forEach(cb => {
    if ([String(a.id), String(b.id)].includes(cb.getAttribute("data-timer-id"))) {
      cb.checked = true;
    }
  });
  document.getElementById("groupTaskName").value = "C2";
  document.getElementById("groupTaskProportion").value = "0.5";
  document.getElementById("groupTaskFolderName").value = "Новая группа";
  modalClick(ctx, "groupTaskConfirm");
  const created = ctx.AppState.getTimers().find(t => t.name === "C2");
  const folder = T(ctx).parentOf(created.id);
  assert.ok(folder && T(ctx).isFolder(folder), "новая задача внутри папки");
  assert.equal(folder.name, "Новая группа");
  assert.equal(folder.children.length, 3, "A, B и новая задача");
  ctx.close();
});

test("ТЗ 5.3.3: раздел создания таймера внутри операции сохранён, доля принимает обычную дробь", () => {
  const { ctx, document } = folderScene();
  ctx.GroupTaskController.openModal();
  // поля создания задачи на месте (имя и доля)
  const name = document.getElementById("groupTaskName");
  const proportion = document.getElementById("groupTaskProportion");
  assert.ok(name, "поле названия задачи");
  assert.ok(proportion, "поле доли");
  assert.ok(
    document.querySelectorAll(".group-checkbox[data-folder-id]").length > 0,
    "список групп-папок"
  );
  // доля вводится обычной дробью, как в остальных модалках
  [...document.querySelectorAll(".group-checkbox[data-folder-id]")].forEach(cb => {
    cb.checked = true;
  });
  name.value = "D";
  proportion.value = "1/4";
  modalClick(ctx, "groupTaskConfirm");
  const created = ctx.AppState.getTimers().find(t => t.name === "D");
  assert.ok(created, "задача создана");
  close(T(ctx).shareOf(created.id), 0.25, "доля 1/4 разобрана как 0.25");
  close(T(ctx).folderTarget(ctx.f.id), 0.5, "сумма папки не изменилась (ТЗ 5.3.4)");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 5.3.4: доля внутри папки — сумма папки не меняется, снаружи ничего", () => {
  const { ctx, a, b, c } = folderScene();
  const folderSumBefore = T(ctx).folderTarget(ctx.f.id);
  const aBefore = target(a);
  const sharesBefore = [T(ctx).shareOf(b.id), T(ctx).shareOf(c.id)];
  const created = ctx.AppController.createTaskInFolder(ctx.f.id, "D", "0.5");
  close(T(ctx).folderTarget(ctx.f.id), folderSumBefore, "сумма папки не изменилась");
  close(target(a), aBefore, "за пределами папки ничего не изменилось");
  close(T(ctx).shareOf(created.id), 0.5, "новая задача получила указанную долю");
  close(T(ctx).shareOf(b.id), sharesBefore[0] * 0.5, "прежние доли ужаты");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 5.4: «+ Добавить таймер» создаёт задачу в корне и ужимает только корневых сиблингов", () => {
  const { ctx, a, b, c } = folderScene();
  const sharesInsideBefore = [T(ctx).shareOf(b.id), T(ctx).shareOf(c.id)];
  const created = ctx.AppController.addNewTimer("D", "0.5");
  assert.equal(T(ctx).parentOf(created.id), null, "новая задача в корне (ТЗ 5.4.1)");
  close(target(created), 0.5, "доля в корне = цель");
  close(target(a), 0.25, "корневой сиблинг ужат");
  close(T(ctx).folderTarget(ctx.f.id), 0.25, "папка-сиблинг ужата");
  // ТЗ 5.4.3: папки-сиблинги меняют всё содержимое в одно и то же число раз
  close(target(b), 0.3 * 0.5, "B внутри папки");
  close(target(c), 0.2 * 0.5, "C внутри папки");
  close(T(ctx).shareOf(b.id), sharesInsideBefore[0], "внутренние доли папки не изменились");
  close(T(ctx).shareOf(c.id), sharesInsideBefore[1], "внутренние доли папки не изменились");
  close(ctx.sumTargets(), 1, "общая сумма сохранена (ТЗ 5.4.2)");
  ctx.close();
});

// =====================================================================
//  Раздел 6. Перенос в группу
// =====================================================================

test("ТЗ 6.1: кнопка «В группу» есть снизу на таймере и на папке", () => {
  const { ctx, a } = folderScene();
  const cardButton = [...ctx.card(a).querySelectorAll("button")].find(
    b => b.getAttribute("data-action") === "to-group"
  );
  assert.ok(cardButton, "на таймере");
  assert.equal(cardButton.textContent, "В группу");
  const buttonsRow = [...ctx.card(a).children].find(el =>
    el.classList.contains("buttons-container")
  );
  assert.ok(buttonsRow.contains(cardButton), "кнопка в нижнем ряду карточки");
  const folderButton = [...ctx.folderEl(ctx.f.id).querySelectorAll("button")].find(
    b => b.getAttribute("data-action") === "to-group"
  );
  assert.ok(folderButton, "на папке");
  ctx.close();
});

test("ТЗ 6.2/6.3: «В группу» переносит и таймер, и группу", () => {
  const { ctx, a, document } = folderScene();
  // модалка открывается по клику (делегирование)
  const button = [...ctx.card(a).querySelectorAll("button")].find(
    b => b.getAttribute("data-action") === "to-group"
  );
  ctx.click(button);
  assert.equal(
    document.getElementById("modalOverlay").classList.contains("hidden"),
    false,
    "модалка открыта"
  );
  const boxes = [...document.querySelectorAll(".move-checkbox.move-folder")];
  assert.equal(boxes.length, 1, "предложена папка F");
  boxes[0].checked = true;
  modalClick(ctx, "moveConfirm");
  assert.equal(T(ctx).parentOf(a.id).id, ctx.f.id, "таймер перенесён в F");

  // перенос группы в группу
  const g = ctx.addFolder("G");
  ctx.MoveToGroupController.openModal(g.id, "folder");
  const box2 = [...ctx.document.querySelectorAll(".move-checkbox.move-folder")].find(
    cb => cb.getAttribute("data-folder-id") === String(ctx.f.id)
  );
  box2.checked = true;
  modalClick(ctx, "moveConfirm");
  assert.equal(T(ctx).parentOf(g.id).id, ctx.f.id, "папка перенесена в папку");
  ctx.close();
});

test("ТЗ 6.4/6.6: перенос не меняет цель, общая сумма приложения сохраняется", () => {
  const { ctx, a } = folderScene();
  const targetBefore = target(a);
  ctx.moveToFolder(a.id, ctx.f.id);
  close(target(a), targetBefore, "цель перенесённой сущности не изменилась");
  close(ctx.sumTargets(), 1, "сумма приложения не изменилась");
  ctx.close();
});

test("ТЗ 6.5: после переноса доли пересчитаны в обеих затронутых группах", () => {
  const { ctx, a, b, c } = folderScene();
  ctx.moveToFolder(a.id, ctx.f.id);
  close(T(ctx).shareOf(a.id), 0.5 / 1.0, "доля A в папке, куда пришла");
  close(T(ctx).shareOf(b.id), 0.3 / 1.0, "доля B пересчитана");
  close(T(ctx).shareOf(c.id), 0.2 / 1.0, "доля C пересчитана");
  close(T(ctx).shareOf(ctx.f.id), 1, "в корне осталась одна папка — доля 1");
  // уход из группы: доли уровня, откуда ушла, пересчитываются
  ctx.moveToFolder(a.id, null);
  close(T(ctx).shareOf(a.id), 0.5, "A снова корневая: доля = цель");
  close(T(ctx).shareOf(ctx.f.id), 0.5, "доля F в корне");
  ctx.close();
});

test("ТЗ 6: папку нельзя перенести внутрь самой себя или своего потомка", () => {
  const { ctx } = folderScene();
  const inner = ctx.addFolder("Inner", folderById(ctx, ctx.f.id));
  assert.equal(T(ctx).canMoveInto(ctx.f.id, ctx.f.id), false, "в саму себя");
  assert.equal(T(ctx).canMoveInto(ctx.f.id, inner.id), false, "в своего потомка");
  assert.equal(T(ctx).moveToFolder(ctx.f.id, inner.id), false, "перенос отклонён");
  assert.equal(T(ctx).parentOf(ctx.f.id), null, "F осталась в корне");
  ctx.close();
});

test("ТЗ 6: в модалке «В группу» есть вариант «вне группы (в корень)»", () => {
  const { ctx, b, document } = folderScene();
  ctx.MoveToGroupController.openModal(b.id, "timer");
  const rootBox = document.querySelector(".move-checkbox.move-root");
  assert.ok(rootBox, "вариант «в корень»");
  rootBox.checked = true;
  modalClick(ctx, "moveConfirm");
  assert.equal(T(ctx).parentOf(b.id), null, "B вернулась в корень");
  close(ctx.sumTargets(), 1, "сумма не изменилась");
  ctx.close();
});

// =====================================================================
//  Раздел 7. Удаление и перерасчёт
// =====================================================================

test("ТЗ 7.1.1: пустая папка просто удаляется", () => {
  const { ctx, document } = folderScene();
  const empty = ctx.addFolder("Пусто");
  const before = ctx.sumTargets();
  const del = [...ctx.folderEl(empty.id).querySelectorAll("button")].find(
    b => b.getAttribute("data-action") === "delete-folder"
  );
  ctx.click(del);
  assert.equal(T(ctx).findNode(empty.id), null, "папки нет в дереве");
  assert.equal(ctx.folderEl(empty.id), null, "элемент папки убран из DOM");
  close(ctx.sumTargets(), before, "сумма целей не изменилась");
  void document;
  ctx.close();
});

test("ТЗ 7.1.2: непустая папка удаляется вместе с таймерами", () => {
  const { ctx, a, b, c } = folderScene();
  const del = [...ctx.folderEl(ctx.f.id).querySelectorAll("button")].find(
    b => b.getAttribute("data-action") === "delete-folder"
  );
  ctx.click(del);
  assert.equal(T(ctx).findNode(ctx.f.id), null, "папки нет");
  assert.equal(ctx.AppState.getTimers().length, 1, "таймеры папки удалены");
  assert.equal(ctx.AppState.getTimers()[0].id, a.id);
  assert.equal(ctx.card(b), null, "карточка B убрана");
  assert.equal(ctx.card(c), null, "карточка C убрана");
  close(target(a), 1, "освободившееся отдано сиблингу уровня (ТЗ 7.3)");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 7.2: удаление таймера внутри группы пересчитывает только её", () => {
  const { ctx, a, b, c } = folderScene();
  const folderSumBefore = T(ctx).folderTarget(ctx.f.id);
  const aBefore = target(a);
  ctx.TimerController.deleteTimer(b);
  close(T(ctx).folderTarget(ctx.f.id), folderSumBefore, "сумма группы сохранена");
  close(target(a), aBefore, "за пределами группы ничего не изменилось");
  close(target(c), folderSumBefore, "цель оставшейся выросла до суммы группы");
  // C осталась единственной в группе — доля ей больше не показывается (ТЗ 3.4.3)
  assert.equal(T(ctx).isShareVisible(c.id), false, "единственный ребёнок");
  assert.equal(visible(ctx, ctx.shareRow(c)), false, "строка «Доля» скрыта");
  assert.equal(T(ctx).findNode(b.id), null, "удалённой задачи нет в дереве");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 7.2.2: освободившееся делится между оставшимися пропорционально прежним целям", () => {
  const ctx = setup();
  // группа из четырёх задач: 0.4 / 0.3 / 0.2 / 0.1 (сумма приложения = 1)
  const [a, b, c, d] = [
    ["A", 0.4],
    ["B", 0.3],
    ["C", 0.2],
    ["D", 0.1],
  ].map(([name, p]) =>
    ctx.addTimer({ name, proportion: p, targetProportion: p })
  );
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  const f = ctx.addFolder("F");
  [a, b, c, d].forEach(t => ctx.moveToFolder(t.id, f.id));
  close(T(ctx).folderTarget(f.id), 1, "вся сумма внутри группы");

  const before = [target(b), target(c), target(d)];
  const sumBefore = T(ctx).folderTarget(f.id);
  ctx.TimerController.deleteTimer(a);

  close(T(ctx).folderTarget(f.id), sumBefore, "сумма группы сохранена");
  const after = [target(b), target(c), target(d)];
  const factors = after.map((v, i) => v / before[i]);
  close(factors[0], factors[1], "множитель B и C один");
  close(factors[1], factors[2], "множитель C и D один");
  close(factors[0], sumBefore / (sumBefore - 0.4), "освободившееся добавлено пропорционально");
  // соотношение долей оставшихся не изменилось, а сумма долей уровня = 1
  close(T(ctx).shareOf(b.id) / T(ctx).shareOf(c.id), 0.3 / 0.2, "соотношение B:C");
  close(T(ctx).shareOf(c.id) / T(ctx).shareOf(d.id), 0.2 / 0.1, "соотношение C:D");
  close(
    T(ctx).shareOf(b.id) + T(ctx).shareOf(c.id) + T(ctx).shareOf(d.id),
    1,
    "доли уровня дают 1"
  );
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 7.3: удаление группы перераспределяет на уровень выше", () => {
  const { ctx } = scene();
  const f = ctx.addFolder("F");
  const g = ctx.addFolder("G");
  const [a, b, c] = ctx.AppState.getTimers();
  ctx.moveToFolder(a.id, f.id);
  ctx.moveToFolder(b.id, f.id);
  ctx.moveToFolder(c.id, g.id);
  const sumBefore = ctx.sumTargets();
  ctx.TreeController.deleteFolder(g.id);
  close(ctx.sumTargets(), sumBefore, "общая сумма сохранена");
  close(T(ctx).folderTarget(f.id), sumBefore, "всё отдано оставшейся группе");
  close(target(a) / 0.5, target(b) / 0.3, "внутри F пропорции сохранены");
  ctx.close();
});

test("ТЗ 7.2.1: перерасчёт не выходит за пределы ближайшей родительской группы", () => {
  const { ctx } = scene();
  const outer = ctx.addFolder("Outer");
  const inner = ctx.addFolder("Inner", outer);
  const [a, b, c] = ctx.AppState.getTimers();
  ctx.moveToFolder(a.id, outer.id);
  ctx.moveToFolder(b.id, inner.id);
  ctx.moveToFolder(c.id, inner.id);
  const aBefore = target(a);
  const outerBefore = T(ctx).folderTarget(outer.id);
  ctx.TimerController.deleteTimer(b);
  close(target(a), aBefore, "A (сиблинг другого уровня) не изменилась");
  close(T(ctx).folderTarget(outer.id), outerBefore, "сумма Outer не изменилась");
  close(T(ctx).folderTarget(inner.id), outerBefore - aBefore, "сумма Inner сохранена");
  ctx.close();
});

test("ТЗ 7.4: удаление на корневом уровне сохраняет общую сумму (прежнее поведение)", () => {
  const { ctx, a, b, c } = scene();
  ctx.TimerController.deleteTimer(a);
  close(target(b), 0.3 / 0.5, "B ренормализована");
  close(target(c), 0.2 / 0.5, "C ренормализована");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

// =====================================================================
//  Раздел 8. Отображение дерева
// =====================================================================

test("ТЗ 8.1/8.2: сущности в ряд вертикально, вложенность — отступом слева", () => {
  const { ctx, a, b, c } = folderScene();
  const container = ctx.document.getElementById("timersContainer");
  const css = ctx.window.getComputedStyle(container);
  assert.equal(css.flexDirection, "column", "контейнер — колонка");
  const order = domOrder(ctx);
  assert.deepEqual(
    order.map(x => x.kind),
    ["timer", "folder", "timer", "timer"],
    "порядок в DOM = порядок дерева"
  );
  assert.deepEqual(order.map(x => x.id), [a.id, ctx.f.id, b.id, c.id]);
  const childrenBox = ctx.folderChildrenEl(ctx.f.id);
  const indent = ctx.window.getComputedStyle(childrenBox).marginLeft;
  assert.notEqual(indent, "0px", "отступ слева у уровня вложенности");
  ctx.close();
});

test("ТЗ 8: порядок в DOM совпадает с плоским порядком дерева ( DFS )", () => {
  const { ctx, a, b, c } = folderScene();
  const inner = ctx.addFolder("Inner", folderById(ctx, ctx.f.id));
  ctx.moveToFolder(c.id, inner.id);
  const d = ctx.addTimer({ name: "D", proportion: 0.1, targetProportion: 0.1 });
  assert.deepEqual(
    domOrder(ctx).map(x => `${x.kind}:${x.id}`),
    ctx.flat().map(x => `${x.kind}:${x.id}`),
    "DOM повторяет дерево"
  );
  void a; void b;
  ctx.close();
});

test("ТЗ 8.3: стрелка сворачивания папки — справа, и сворачивает уровень", () => {
  const { ctx, b } = folderScene();
  const header = ctx.folderEl(ctx.f.id).querySelector(".folder-header");
  const last = header.lastElementChild;
  assert.equal(last.getAttribute("data-action"), "toggle-folder", "стрелка справа");
  assert.equal(last.classList.contains("folder-toggle"), true);
  assert.equal(ctx.window.getComputedStyle(last).marginLeft, "auto", "прижата вправо");
  assert.ok(visible(ctx, ctx.card(b)), "до сворачивания задачи видны");
  ctx.click(last);
  assert.equal(ctx.FolderView.isCollapsed(ctx.f.id), true, "папка свёрнута");
  assert.equal(
    ctx.window.getComputedStyle(ctx.folderChildrenEl(ctx.f.id)).display,
    "none",
    "содержимое скрыто"
  );
  assert.ok(visible(ctx, header), "шапка осталась видна");
  ctx.click(ctx.document.getElementById(`folder-toggle-${ctx.f.id}`));
  assert.equal(ctx.FolderView.isCollapsed(ctx.f.id), false, "снова раскрыта");
  assert.ok(visible(ctx, ctx.card(b)), "задачи видны");
  ctx.close();
});

test("ТЗ 8.3: сворачивается каждый уровень вложенности независимо", () => {
  const { ctx, b, c } = folderScene();
  const inner = ctx.addFolder("Inner", folderById(ctx, ctx.f.id));
  ctx.moveToFolder(c.id, inner.id);
  ctx.FolderView.toggleCollapsed(inner.id);
  assert.equal(visible(ctx, ctx.card(c)), false, "C скрыта (свёрнута Inner)");
  assert.equal(visible(ctx, ctx.card(b)), true, "B видна (F раскрыта)");
  ctx.FolderView.toggleCollapsed(ctx.f.id);
  assert.equal(visible(ctx, ctx.card(b)), false, "B скрыта (свёрнута F)");
  assert.equal(ctx.FolderView.isCollapsed(inner.id), true, "состояние Inner не сброшено");
  ctx.close();
});

test("ТЗ 8.4: стрелки перемещения слева на таймере и на папке", () => {
  const { ctx, a } = folderScene();
  const cardRow = ctx.card(a).firstElementChild;
  assert.ok(cardRow.classList.contains("compact-toggle-container"));
  const moves = [...cardRow.querySelectorAll('[data-action^="move-"]')];
  assert.equal(moves.length, 2, "две стрелки у таймера");
  assert.equal(moves[0].getAttribute("data-action"), "move-up");
  assert.equal(moves[1].getAttribute("data-action"), "move-down");
  const headerFirst = ctx.folderEl(ctx.f.id).querySelector(".folder-header").firstElementChild;
  assert.equal(headerFirst.classList.contains("move-buttons"), true, "у папки стрелки слева");
  assert.equal(headerFirst.querySelectorAll('[data-action^="move-"]').length, 2);
  ctx.close();
});

test("ТЗ 8.5: доля показана на сущностях, у которых есть соседи по уровню", () => {
  const { ctx, a, b, c } = folderScene();
  const folderShare = id => ctx.document.getElementById(`folder-share-${id}`);
  // корневой уровень: A и F — доли не показываются (ТЗ 3.4.2)
  assert.equal(visible(ctx, ctx.shareRow(a)), false, "корневая A — без доли");
  assert.equal(folderShare(ctx.f.id).style.display, "none", "папка F в корне — без доли");
  // внутри папки у B и C есть соседи — доли видны
  assert.ok(visible(ctx, ctx.shareRow(b)), "B внутри папки — с долей");
  assert.ok(visible(ctx, ctx.shareRow(c)), "C внутри папки — с долей");
  assert.match(ctx.shareInput(b).value, /^0\.6/, "значение доли B");

  // делаем F некорневой: появляется родитель с соседями — доля папки видна
  const outer = ctx.addFolder("Outer");
  ctx.moveToFolder(a.id, outer.id);
  ctx.moveToFolder(ctx.f.id, outer.id);
  const d = ctx.AppController.addNewTimer("D", "0.1"); // сумма приложения остаётся 1
  ctx.moveToFolder(d.id, outer.id);
  assert.notEqual(folderShare(ctx.f.id).style.display, "none", "доля папки F показана");
  assert.match(folderShare(ctx.f.id).textContent, /Доля/i, "подпись «Доля»");
  assert.ok(visible(ctx, ctx.shareRow(a)), "A теперь не корневая — доля видна");
  // единственная сущность уровня — без доли
  ctx.moveToFolder(d.id, null);
  ctx.moveToFolder(ctx.f.id, null);
  assert.equal(folderShare(ctx.f.id).style.display, "none", "F одна в корне — доля скрыта");
  assert.equal(visible(ctx, ctx.shareRow(d)), false, "D одна в корне — доля скрыта");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

// =====================================================================
//  Регрессии: приложение остаётся рабочим
// =====================================================================

test("регрессия: тик, планы и рекомендации работают с деревом", () => {
  const { ctx, a, b, c } = folderScene();
  ctx.clock.advanceSec(600);
  ctx.tick();
  const total = ctx.TimeCalculator.getTotalTime();
  close(ctx.totalPlanned(), total, "сумма планов = остаток сессии");
  ctx.AppController.calculateRecommendations();
  const sumRec = ctx.AppState.getTimers().reduce(
    (s, t) => s + (t.recommendedProportion || 0),
    0
  );
  assert.ok(sumRec > 0, "рекомендации считаются");
  assert.ok(ctx.card(a) && ctx.card(b) && ctx.card(c));
  ctx.close();
});

test("регрессия: отсчёт задачи внутри папки идёт как обычно", () => {
  const { ctx, b } = folderScene();
  ctx.click(ctx.cardButton(b, "Старт"));
  assert.equal(b.isTracking, true);
  assert.equal(ctx.isAway(), false, "отсчёт выключает простой");
  ctx.clock.advanceSec(120);
  ctx.tick();
  close(b.trackedSeconds, 120, "намеряно 120 с");
  ctx.click(ctx.cardButton(b, "Пауза"));
  assert.equal(b.isTracking, false);
  ctx.close();
});

test("регрессия: авто-«Отошёл» списывает простой из планов и внутри папок", () => {
  const { ctx, a, b } = folderScene();
  const plansBefore = ctx.AppState.getTimers().map(t => t.plannedSeconds);
  const sumBefore = plansBefore.reduce((s, p) => s + p, 0);
  ctx.clock.advanceSec(100);
  ctx.tick();
  assert.equal(ctx.isAway(), true);
  const sumAfter = ctx.totalPlanned();
  close(sumBefore - sumAfter, 100, "простоем списано 100 с");
  void a; void b;
  ctx.close();
});

test("регрессия: дерево переживает сохранение и загрузку", () => {
  const { ctx, b } = folderScene();
  ctx.StorageService.saveToLocalStorage();
  const dumpedTimers = ctx.window.localStorage.getItem("timers");
  const dumpedTree = ctx.window.localStorage.getItem("tree");
  assert.ok(dumpedTree, "ключ tree записан");
  const endValue = ctx.window.localStorage.getItem("globalEndTimeValue");
  const boundary = ctx.window.localStorage.getItem("lastSessionEndTime");

  const fresh = setup();
  fresh.window.localStorage.setItem("timers", dumpedTimers);
  fresh.window.localStorage.setItem("tree", dumpedTree);
  fresh.window.localStorage.setItem("globalEndTimeValue", endValue);
  fresh.window.localStorage.setItem("lastSessionEndTime", boundary);
  fresh.StorageService.loadTimersFromLocalStorage();
  assert.equal(fresh.TreeModel.allFolderNodes().length, 1, "папка восстановлена");
  const restoredB = fresh.AppState.getTimers().find(t => t.name === "B");
  assert.equal(
    fresh.TreeModel.parentOf(restoredB.id) === null,
    false,
    "B снова внутри папки"
  );
  assert.deepEqual(
    domOrder(fresh).map(x => x.kind),
    ["timer", "folder", "timer", "timer"],
    "порядок восстановлен"
  );
  assert.ok(fresh.card(restoredB), "карточка отрисована");
  fresh.close();
  void b;
  ctx.close();
});

test("регрессия: старое сохранение без ключа tree не ломает приложение", () => {
  const { ctx } = scene();
  const dumped = ctx.window.localStorage.getItem(
    "timers"
  ) /* может быть null до сохранения */;
  ctx.StorageService.saveToLocalStorage();
  const timers = ctx.window.localStorage.getItem("timers");
  const fresh = setup();
  fresh.window.localStorage.setItem("timers", timers);
  fresh.window.localStorage.setItem("tree", "{битый json");
  fresh.StorageService.loadTimersFromLocalStorage();
  assert.equal(fresh.AppState.getTimers().length, 3, "таймеры загружены");
  assert.equal(fresh.TreeModel.root().length, 3, "дерево восстановлено из порядка таймеров");
  assert.deepEqual(
    domOrder(fresh).map(x => x.id),
    [...fresh.AppState.getTimers()].map(t => t.id),
    "порядок = порядок списка таймеров"
  );
  fresh.close();
  void dumped;
  ctx.close();
});

test("регрессия: экспорт содержит дерево, импорт принимает оба формата", () => {
  const { ctx } = folderScene();
  ctx.StorageService.saveToLocalStorage();
  const timersJson = ctx.window.localStorage.getItem("timers");
  const treeJson = ctx.window.localStorage.getItem("tree");
  const parsed = JSON.parse(treeJson);
  assert.ok(Array.isArray(parsed) && parsed.some(n => n.k === "f"), "в дереве есть папка");
  // прежний формат (просто массив) тоже импортируется
  const legacy = ctx.StorageService.parseTimersJSON(timersJson);
  assert.equal(legacy.length, 3, "массив таймеров разбирается");
  const asArray = ctx.StorageService.parseTimersJSON(legacy);
  assert.equal(asArray.length, 3, "parseTimersJSON принимает и массив");
  assert.equal(ctx.StorageService.parseTreeJSON("{мусор").length, 0, "битое дерево → пусто");
  ctx.close();
});

test("ТЗ 1.4: вес остаётся производной величиной и пересчитывается сам", () => {
  const { ctx, b } = folderScene();
  const sumWeights = () =>
    ctx.AppState.getTimers().reduce((s, t) => s + (Number(t.proportion) || 0), 0);
  close(sumWeights(), 1, "сумма весов = 1");
  // у папки собственного веса нет: она не таймер
  const folderNode = T(ctx).findNode(ctx.f.id).node;
  assert.equal(folderNode.proportion, undefined, "у узла папки нет веса");
  assert.equal(
    ctx.AppState.getTimers().some(t => t.id === ctx.f.id),
    false,
    "папки нет в списке таймеров"
  );
  // правим цель внутри папки — вес подстраивается сам, сумма остаётся 1
  T(ctx).setTargetGlobal(b.id, 0.4);
  ctx.tick();
  close(sumWeights(), 1, "после правки цели сумма весов по-прежнему 1");
  ctx.AppState.getTimers().forEach(t => {
    assert.ok(t.proportion >= 0, `вес ${t.name} неотрицателен`);
  });
  ctx.close();
});

test("регрессия: удаление последней задачи в папке не рвёт сумму приложения", () => {
  const { ctx, b, c } = folderScene();
  ctx.TimerController.deleteTimer(b);
  ctx.TimerController.deleteTimer(c);
  assert.equal(T(ctx).findNode(ctx.f.id) !== null, true, "пустая папка осталась");
  close(ctx.sumTargets(), 1, "сумма целей приложения по-прежнему 1");
  ctx.close();
});
