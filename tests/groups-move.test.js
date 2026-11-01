// Автотесты перемещения стрелками (ТЗ 9) и синхронизации порядка (ТЗ 10).
//
// Главный принцип ТЗ 9.2: движение буквально по вертикали, а чтобы попасть
// ВНУТРЬ соседней группы, всегда нужен дополнительный клик — погружение
// происходит только с края своего уровня. На самом верхнем уровне сущность с
// края переносится в противоположный конец, оставаясь вне группы (9.4.1), и
// уже следующий клик погружает её в группу (9.4.2), а следующий — глубже,
// в группу внутри группы (9.4.3). Вниз работает симметрично (9.4.4).
//
// ТЗ 10: порядок узлов обязан быть идентичным на всех устройствах, поэтому
// дерево сериализуется в ключ "tree", ключ входит в CloudSync.STATE_KEYS,
// а перестановка узлов считается осмысленным изменением (в проекции дерево
// участвует БЕЗ сортировки — в отличие от списка таймеров).
//
// Запуск:  npm test     (node --test tests/)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, DEFAULT_END } = require("./harness.js");

after(closeAll);

const close = (actual, expected, msg) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${msg}: ${actual} != ${expected}`
  );

const T = ctx => ctx.TreeModel;
const target = t => Number(t.targetProportion);
const byName = (ctx, name) => {
  const t = ctx.AppState.getTimers().find(x => x.name === name);
  assert.ok(t, `таймер ${name} найден`);
  return t;
};

/** Человекочитаемая подпись узла: имя папки или имя задачи. */
function label(ctx, id) {
  const loc = T(ctx).findNode(id);
  if (!loc) return `?${id}`;
  return T(ctx).isFolder(loc.node) ? loc.node.name : loc.node.timerName || timerName(ctx, id);
}
function timerName(ctx, id) {
  const t = ctx.AppState.getTimers().find(x => String(x.id) === String(id));
  return t ? t.name : `?${id}`;
}
/** Порядок КОРНЯ подписями: ["A", "F", "D"]. */
const rootLabels = ctx => ctx.rootOrder().map(id => label(ctx, id));
/** Всё дерево подписями с отступом уровня — ровно как на экране. */
const treeLabels = ctx =>
  ctx.flat().map(x => `${"  ".repeat(x.depth)}${label(ctx, x.id)}`);
const depthOf = (ctx, name) => {
  const node = findByName(ctx, name);
  return ctx.flat().find(x => String(x.id) === String(node.id)).depth;
};
/** Узел (таймер или папка) по имени. */
function findByName(ctx, name) {
  const timer = ctx.AppState.getTimers().find(t => t.name === name);
  if (timer) return T(ctx).findNode(timer.id).node;
  const folder = T(ctx).allFolderNodes().find(f => f.name === name);
  assert.ok(folder, `папка ${name} найдена`);
  return folder;
}
const idOfName = (ctx, name) => findByName(ctx, name).id;
/** Подписи непосредственных детей папки (массив области Node — для deepEqual). */
const childLabels = (ctx, folderName) =>
  Array.from(
    T(ctx)
      .childrenOf(idOfName(ctx, folderName))
      .map(n => label(ctx, n.id))
  );
const parentLabel = (ctx, name) => {
  const p = T(ctx).parentOf(idOfName(ctx, name));
  return p ? p.name : null;
};
/** Порядок в DOM (DFS) — то, что реально видит пользователь. */
function domLabels(ctx) {
  const out = [];
  const walk = (host, depth) => {
    [...host.children].forEach(el => {
      if (el.classList && el.classList.contains("folder-node")) {
        const id = el.getAttribute("data-folder-id");
        out.push(`${"  ".repeat(depth)}${label(ctx, Number(id))}`);
        walk(ctx.folderChildrenEl(Number(id)), depth + 1);
      } else if (el.id && el.id.startsWith("timer-")) {
        out.push(`${"  ".repeat(depth)}${timerName(ctx, el.id.slice(6))}`);
      }
    });
  };
  walk(ctx.document.getElementById("timersContainer"), 0);
  return out;
}

/**
 * Сцена из именованных задач. `folders` — список [имя, [дети...]]: папка
 * создаётся в конце корня, затем в неё переносятся перечисленные задачи.
 */
function scene(spec, opts = {}) {
  const ctx = setup(opts);
  const shares = opts.shares || {};
  spec.timers.forEach((name, i) => {
    const p =
      shares[name] !== undefined
        ? shares[name]
        : 1 / spec.timers.length;
    ctx.addTimer({ name, proportion: p, targetProportion: p });
  });
  (spec.folders || []).forEach(([folderName, children]) => {
    const folder = ctx.addFolder(folderName);
    children.forEach(child => {
      const node = findByName(ctx, child);
      ctx.moveToFolder(node.id, folder.id);
    });
  });
  ctx.setEndTime(opts.end || DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, document: ctx.document };
}

// =====================================================================
//  ТЗ 9.1 — стрелки перемещают группу целиком или отдельный таймер
// =====================================================================

test("ТЗ 9.1: группа перемещается целиком, со всем содержимым", () => {
  const { ctx } = scene({ timers: ["A", "B", "C", "D"], folders: [["F", ["B", "C"]]] });
  assert.deepEqual(rootLabels(ctx), ["A", "D", "F"], "исходный корень");
  const targetsBefore = ctx.AppState.getTimers().map(t => [t.name, target(t)]);

  assert.equal(ctx.TreeController.move(idOfName(ctx, "F"), "up"), true);

  assert.deepEqual(rootLabels(ctx), ["A", "F", "D"], "папка поднялась на позицию");
  assert.deepEqual(childLabels(ctx, "F"), ["B", "C"], "содержимое папки не перемешалось");
  assert.equal(depthOf(ctx, "B"), 1, "B осталась на уровне 1");
  assert.equal(depthOf(ctx, "C"), 1, "C осталась на уровне 1");
  // цели при перестановке внутри уровня не меняются (ТЗ 9.5)
  ctx.AppState.getTimers().forEach(t => {
    const before = targetsBefore.find(([n]) => n === t.name)[1];
    close(target(t), before, `цель ${t.name}`);
  });
  ctx.close();
});

test("ТЗ 9.1: отдельный таймер перемещается относительно таймеров и групп", () => {
  const { ctx } = scene({ timers: ["A", "B", "C", "D"], folders: [["F", ["C"]]] });
  // корень: A, B, D, F  (папка создана последней)
  assert.deepEqual(rootLabels(ctx), ["A", "B", "D", "F"]);
  ctx.TreeController.move(idOfName(ctx, "B"), "down");
  assert.deepEqual(rootLabels(ctx), ["A", "D", "B", "F"], "обмен с таймером");
  assert.equal(parentLabel(ctx, "B"), null, "B осталась в корне");
  ctx.TreeController.move(idOfName(ctx, "B"), "down");
  assert.deepEqual(rootLabels(ctx), ["A", "D", "F", "B"], "B встала за папкой, не входя в неё");
  assert.equal(parentLabel(ctx, "B"), null, "в группу одним кликом из середины не попала");
  ctx.close();
});

// =====================================================================
//  ТЗ 9.2 — чтобы попасть в группу, нужен дополнительный клик
// =====================================================================

test("ТЗ 9.2: первый клик только меняет порядок, второй (с края) заводит в группу", () => {
  const { ctx } = scene({ timers: ["X", "A", "B"], folders: [["F", ["B"]]] });
  assert.deepEqual(rootLabels(ctx), ["X", "A", "F"], "исходный корень");

  // клик 1: A в середине уровня (индекс 1), поэтому погружения нет —
  // только обмен местами с папкой, A оказывается на нижнем краю уровня
  ctx.TreeController.move(idOfName(ctx, "A"), "down");
  assert.deepEqual(rootLabels(ctx), ["X", "F", "A"], "порядок изменился");
  assert.equal(parentLabel(ctx, "A"), null, "внутри группы A ещё не оказалась");
  assert.equal(depthOf(ctx, "A"), 0, "уровень не изменился");

  // клик 2 (дополнительный, ТЗ 9.4.2): A на нижнем краю, сверху папка →
  // нажатие «вверх» погружает её в группу
  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.equal(parentLabel(ctx, "A"), "F", "второй клик завёл A в группу");
  assert.equal(depthOf(ctx, "A"), 1, "уровень вложенности 1");
  assert.deepEqual(childLabels(ctx, "F"), ["B", "A"], "A встала последней в группе");
  ctx.close();
});

test("ТЗ 9.2: из середины уровня внутрь группы не попасть ни вверх, ни вниз", () => {
  const { ctx } = scene({
    timers: ["A", "B", "C", "D"],
    folders: [["F1", ["C"]], ["F2", ["D"]]],
  });
  // корень: A, B, F1, F2 → B между A и F1
  assert.deepEqual(rootLabels(ctx), ["A", "B", "F1", "F2"]);
  ctx.TreeController.move(idOfName(ctx, "B"), "down");
  assert.equal(parentLabel(ctx, "B"), null, "не inside F1");
  assert.deepEqual(rootLabels(ctx), ["A", "F1", "B", "F2"]);
  ctx.close();
});

// =====================================================================
//  ТЗ 9.3 — край уровня вложенности: выход из группы
// =====================================================================

test("ТЗ 9.3.1: «вверх» с самого верха уровня выводит сущность ровно над группой", () => {
  const { ctx } = scene({ timers: ["X", "A", "B"], folders: [["F", ["A", "B"]]] });
  assert.deepEqual(treeLabels(ctx), ["X", "F", "  A", "  B"], "исходное дерево");

  ctx.TreeController.move(idOfName(ctx, "A"), "up");

  assert.deepEqual(
    treeLabels(ctx),
    ["X", "A", "F", "  B"],
    "A вышла из группы и встала ровно над ней"
  );
  assert.equal(parentLabel(ctx, "A"), null, "A снова корневая");
  assert.equal(depthOf(ctx, "B"), 1, "B осталась в группе");
  ctx.close();
});

test("ТЗ 9.3.2: «вниз» с самого низа уровня выводит сущность ровно под группой", () => {
  const { ctx } = scene({ timers: ["A", "B", "X"], folders: [["F", ["A", "B"]]] });
  // A и B перенесены в папку, поэтому в корне остались X и F
  assert.deepEqual(treeLabels(ctx), ["X", "F", "  A", "  B"], "исходное дерево");

  ctx.TreeController.move(idOfName(ctx, "B"), "down");

  assert.deepEqual(
    treeLabels(ctx),
    ["X", "F", "  A", "B"],
    "B вышла из группы и встала ровно под ней"
  );
  assert.equal(parentLabel(ctx, "B"), null);
  ctx.close();
});

test("ТЗ 9.3: выход из вложенной группы поднимает только на один уровень", () => {
  const { ctx } = scene({
    timers: ["X", "A", "B"],
    folders: [["Outer", []], ["Inner", ["A", "B"]]],
  });
  // Outer создана первой (в корне), Inner — второй (тоже в корне);
  // вручную кладём Inner внутрь Outer
  ctx.moveToFolder(idOfName(ctx, "Inner"), idOfName(ctx, "Outer"));
  assert.deepEqual(treeLabels(ctx), ["X", "Outer", "  Inner", "    A", "    B"]);

  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.deepEqual(
    treeLabels(ctx),
    ["X", "Outer", "  A", "  Inner", "    B"],
    "A поднялась ровно на один уровень — в Outer, над Inner"
  );
  assert.equal(parentLabel(ctx, "A"), "Outer", "родитель — Outer (не корень)");
  assert.equal(depthOf(ctx, "A"), 1, "уровень 1, а не 0");

  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.equal(parentLabel(ctx, "A"), null, "второй клик вывел A в корень");
  assert.deepEqual(treeLabels(ctx), ["X", "A", "Outer", "  Inner", "    B"]);
  ctx.close();
});

// =====================================================================
//  ТЗ 9.4 — самый верхний уровень: перенос с края и погружение
// =====================================================================

test("ТЗ 9.4.1: «вверх» с самого верха переносит в самый низ, вне группы", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  assert.deepEqual(rootLabels(ctx), ["A", "B", "C"]);
  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.deepEqual(rootLabels(ctx), ["B", "C", "A"], "A перенесена в самый низ");
  assert.equal(parentLabel(ctx, "A"), null, "A вне группы");
  assert.equal(depthOf(ctx, "A"), 0, "уровень тот же — корневой");
  ctx.close();
});

test("ТЗ 9.4.4: «вниз» с самого низа верхнего уровня переносит в самый верх", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  ctx.TreeController.move(idOfName(ctx, "C"), "down");
  assert.deepEqual(rootLabels(ctx), ["C", "A", "B"], "C перенесена в самый верх");
  assert.equal(parentLabel(ctx, "C"), null, "C вне группы");
  ctx.close();
});

test("ТЗ 9.4.1: перенос с края верхнего уровня не заваливает сущность в группу", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"], folders: [["F", ["B"]]] });
  // B перенесена в папку, папка создана последней
  assert.deepEqual(rootLabels(ctx), ["A", "C", "F"], "исходный корень");
  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.deepEqual(rootLabels(ctx), ["C", "F", "A"], "A в самом низу");
  assert.equal(parentLabel(ctx, "A"), null, "A осталась вне группы");
  ctx.close();
});

test("ТЗ 9.4.2: следующее «вверх» погружает сущность в группу на один уровень", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"], folders: [["F", ["C"]]] });
  assert.deepEqual(rootLabels(ctx), ["A", "B", "F"]);
  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // перенос в самый низ
  assert.deepEqual(rootLabels(ctx), ["B", "F", "A"]);
  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // погружение
  assert.equal(parentLabel(ctx, "A"), "F", "A внутри группы");
  assert.deepEqual(treeLabels(ctx), ["B", "F", "  C", "  A"], "A встала последней в F");
  assert.equal(depthOf(ctx, "A"), 1, "уровень 1");
  ctx.close();
});

test("ТЗ 9.4.3: ещё одно «вверх» погружает глубже — в группу внутри группы", () => {
  const { ctx } = scene({
    timers: ["X", "A", "H"],
    folders: [["F", []], ["G", ["H"]]],
  });
  // F[G[H]] в корне, X и A — тоже в корне
  ctx.moveToFolder(idOfName(ctx, "G"), idOfName(ctx, "F"));
  assert.deepEqual(treeLabels(ctx), ["X", "A", "F", "  G", "    H"]);

  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // A внизу? нет: A в середине
  // A — индекс 1 из 3, сверху X: обычный обмен
  assert.deepEqual(rootLabels(ctx), ["A", "X", "F"], "обычный обмен в середине уровня");

  // доведём A до самого низа верхнего уровня и будем нажимать «вверх»
  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // перенос в самый низ
  assert.deepEqual(rootLabels(ctx), ["X", "F", "A"], "A в самом низу, вне группы");

  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // клик 1 — в первую группу
  assert.equal(parentLabel(ctx, "A"), "F", "A внутри F");
  assert.deepEqual(treeLabels(ctx), ["X", "F", "  G", "    H", "  A"]);

  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // клик 2 — во вторую
  assert.equal(parentLabel(ctx, "A"), "G", "A внутри G (группа внутри группы)");
  assert.deepEqual(treeLabels(ctx), ["X", "F", "  G", "    H", "    A"]);
  assert.equal(depthOf(ctx, "A"), 2, "уровень 2");
  ctx.close();
});

test("ТЗ 9.4.4: «вниз» с самого верха сразу в группу, затем глубже", () => {
  const { ctx } = scene({
    timers: ["A", "X", "H"],
    folders: [["F", []], ["G", ["H"]]],
  });
  ctx.moveToFolder(idOfName(ctx, "G"), idOfName(ctx, "F"));
  ctx.TreeController.move(idOfName(ctx, "X"), "down"); // X уходит вниз, A остаётся
  ctx.TreeController.move(idOfName(ctx, "F"), "up"); // F поднимаем наверх
  assert.deepEqual(rootLabels(ctx), ["F", "A", "X"], "F сверху, A сразу под ней");

  ctx.TreeController.move(idOfName(ctx, "A"), "up"); // A — не вверху? A индекс 1 → обмен
  assert.deepEqual(rootLabels(ctx), ["A", "F", "X"], "обычный обмен");
  ctx.TreeController.move(idOfName(ctx, "A"), "down"); // A сверху, под ней F → погружение
  assert.equal(parentLabel(ctx, "A"), "F", "A внутри F");
  assert.deepEqual(treeLabels(ctx), ["F", "  A", "  G", "    H", "X"]);

  ctx.TreeController.move(idOfName(ctx, "A"), "down"); // A сверху внутри F, под ней G
  assert.equal(parentLabel(ctx, "A"), "G", "A погрузилась в G");
  assert.deepEqual(treeLabels(ctx), ["F", "  G", "    A", "    H", "X"]);
  assert.equal(depthOf(ctx, "A"), 2, "уровень 2");
  ctx.close();
});

// =====================================================================
//  ТЗ 9.5 — перемещение не меняет цель, но меняет суммы и доли уровней
// =====================================================================

test("ТЗ 9.5: перемещение не меняет целевую пропорцию сущности", () => {
  const { ctx } = scene({
    timers: ["A", "B", "C"],
    folders: [["F", ["C"]]],
  }, { shares: { A: 0.5, B: 0.3, C: 0.2 } });
  const beforeB = target(byName(ctx, "B"));
  close(ctx.sumTargets(), 1, "исходная сумма");

  ctx.TreeController.move(idOfName(ctx, "B"), "up"); // B в самый низ
  ctx.TreeController.move(idOfName(ctx, "B"), "up"); // B погружается в F

  close(target(byName(ctx, "B")), beforeB, "цель B не изменилась");
  close(ctx.sumTargets(), 1, "сумма приложения не изменилась");
  ctx.close();
});

test("ТЗ 9.5.1/9.5.2: доли пересчитаны в уровне, куда пришла, и откуда ушла", () => {
  const { ctx } = scene({
    timers: ["A", "B", "C"],
    folders: [["F", ["C"]]],
  }, { shares: { A: 0.5, B: 0.3, C: 0.2 } });
  // корень [A 0.5, B 0.3, F(0.2)] — сумма уровня 1.0
  close(T(ctx).shareOf(idOfName(ctx, "F")), 0.2, "доля F до перемещения");
  close(T(ctx).shareOf(idOfName(ctx, "B")), 0.3, "доля B до перемещения");

  // корень [A, B, F]: один клик «вниз» ставит B под папку (на край уровня),
  // второй клик «вверх» погружает её в группу (ТЗ 9.2/9.4.2)
  ctx.TreeController.move(idOfName(ctx, "B"), "down");
  assert.deepEqual(rootLabels(ctx), ["A", "F", "B"], "B под папкой");
  assert.equal(parentLabel(ctx, "B"), null, "пока в корне");
  ctx.TreeController.move(idOfName(ctx, "B"), "up"); // погружение в F
  assert.equal(parentLabel(ctx, "B"), "F", "B внутри F");

  // уровень F: был C 0.2, стал C 0.2 + B 0.3 = 0.5
  close(T(ctx).folderTarget(idOfName(ctx, "F")), 0.5, "сумма группы выросла");
  close(T(ctx).shareOf(idOfName(ctx, "C")), 0.2 / 0.5, "доля C внутри F");
  close(T(ctx).shareOf(idOfName(ctx, "B")), 0.3 / 0.5, "доля B внутри F");
  // корневой уровень: A 0.5 и F 0.5
  close(T(ctx).shareOf(idOfName(ctx, "A")), 0.5, "доля A в корне");
  close(T(ctx).shareOf(idOfName(ctx, "F")), 0.5, "доля F в корне выросла");
  close(ctx.sumTargets(), 1, "сумма приложения 1");
  ctx.close();
});

test("ТЗ 9.5.3: перемещение стрелками даёт тот же результат, что «В группу»", () => {
  const spec = { timers: ["A", "B", "C"], folders: [["F", ["C"]]] };
  const shares = { A: 0.5, B: 0.3, C: 0.2 };

  // вариант 1: стрелками (перенос в низ, затем погружение)
  const one = scene(spec, { shares });
  one.ctx.TreeController.move(idOfName(one.ctx, "B"), "down"); // к нижнему краю
  one.ctx.TreeController.move(idOfName(one.ctx, "B"), "up"); // погружение в F

  // вариант 2: кнопкой «В группу»
  const two = scene(spec, { shares });
  two.ctx.MoveToGroupController.openModal(idOfName(two.ctx, "B"), "timer");
  const box = [...two.document.querySelectorAll(".move-checkbox.move-folder")].find(
    cb => cb.getAttribute("data-folder-id") === String(idOfName(two.ctx, "F"))
  );
  box.checked = true;
  two.ctx.ModalController.handleOverlayClick({
    target: two.document.getElementById("moveConfirm"),
  });

  assert.equal(parentLabel(one.ctx, "B"), "F", "стрелками B попала в F");
  assert.equal(parentLabel(two.ctx, "B"), "F", "кнопкой B попала в F");
  assert.deepEqual(treeLabels(one.ctx), treeLabels(two.ctx), "дерево одинаковое");
  ["A", "B", "C"].forEach(name => {
    close(
      target(byName(one.ctx, name)),
      target(byName(two.ctx, name)),
      `цель ${name} совпадает`
    );
    close(
      T(one.ctx).shareOf(idOfName(one.ctx, name)),
      T(two.ctx).shareOf(idOfName(two.ctx, name)),
      `доля ${name} совпадает`
    );
  });
  one.ctx.close();
  two.ctx.close();
});

test("ТЗ 9.5 + 3.9.2: перестановка группы в уровне не меняет её внутренние доли", () => {
  const { ctx } = scene({
    timers: ["A", "B", "C", "D"],
    folders: [["F", ["B", "C"]], ["G", ["D"]]],
  });
  const sharesBefore = T(ctx)
    .childrenOf(idOfName(ctx, "F"))
    .map(n => T(ctx).shareOf(n.id));
  const targetsBefore = T(ctx)
    .childrenOf(idOfName(ctx, "F"))
    .map(n => target(T(ctx).timerById(n.id)));

  ctx.TreeController.move(idOfName(ctx, "F"), "down"); // обмен с G
  assert.deepEqual(rootLabels(ctx), ["A", "G", "F"], "папки поменялись местами");

  const sharesAfter = T(ctx)
    .childrenOf(idOfName(ctx, "F"))
    .map(n => T(ctx).shareOf(n.id));
  const targetsAfter = T(ctx)
    .childrenOf(idOfName(ctx, "F"))
    .map(n => target(T(ctx).timerById(n.id)));
  assert.deepEqual(sharesAfter, sharesBefore, "внутренние доли не изменились");
  assert.deepEqual(targetsAfter, targetsBefore, "внутренние цели не изменились");
  ctx.close();
});

// =====================================================================
//  Стрелки в интерфейсе
// =====================================================================

test("ТЗ 8.4/9.1: клик по стрелке карточки перемещает таймер и перерисовывает дерево", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"], folders: [["F", ["C"]]] });
  const before = domLabels(ctx);
  assert.deepEqual(before, ["A", "B", "F", "  C"], "исходный DOM");

  const down = ctx.moveButton(byName(ctx, "B"), "down");
  assert.ok(down, "стрелка «вниз» у карточки есть");
  ctx.click(down);

  assert.deepEqual(rootLabels(ctx), ["A", "F", "B"], "модель обновилась");
  assert.deepEqual(domLabels(ctx), treeLabels(ctx), "DOM совпадает с деревом");
  assert.deepEqual(domLabels(ctx), ["A", "F", "  C", "B"], "DOM перерисован");
  ctx.close();
});

test("ТЗ 8.4/9.1: клик по стрелке шапки папки перемещает группу целиком", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"], folders: [["F", ["B", "C"]]] });
  assert.deepEqual(domLabels(ctx), ["A", "F", "  B", "  C"], "исходный DOM");

  const up = ctx.moveButton(idOfName(ctx, "F"), "up");
  assert.ok(up, "стрелка «вверх» у папки есть");
  ctx.click(up);

  assert.deepEqual(domLabels(ctx), ["F", "  B", "  C", "A"], "папка поднялась с содержимым");
  assert.deepEqual(domLabels(ctx), treeLabels(ctx), "DOM = дерево");
  ctx.close();
});

// =====================================================================
//  Граничные случаи
// =====================================================================

test("граница: единственная сущность в корне перемещается безопасно", () => {
  const { ctx } = scene({ timers: ["A"] });
  assert.deepEqual(rootLabels(ctx), ["A"]);
  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.deepEqual(rootLabels(ctx), ["A"], "осталась на месте");
  ctx.TreeController.move(idOfName(ctx, "A"), "down");
  assert.deepEqual(rootLabels(ctx), ["A"], "осталась на месте");
  assert.equal(parentLabel(ctx, "A"), null, "вне группы");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

test("граница: единственный ребёнок группы по «вверх» выходит наружу", () => {
  const { ctx } = scene({ timers: ["X", "A"], folders: [["F", ["A"]]] });
  assert.deepEqual(treeLabels(ctx), ["X", "F", "  A"]);
  ctx.TreeController.move(idOfName(ctx, "A"), "up");
  assert.deepEqual(treeLabels(ctx), ["X", "A", "F"], "A вышла и встала над группой");
  assert.equal(parentLabel(ctx, "A"), null);
  ctx.close();
});

test("граница: перемещение несуществующего узла не ломает дерево", () => {
  const { ctx } = scene({ timers: ["A", "B"] });
  const before = rootLabels(ctx);
  assert.equal(T(ctx).move(999999, "up"), false, "модель отказала");
  assert.equal(T(ctx).move(999999, "down"), false, "модель отказала");
  assert.deepEqual(rootLabels(ctx), before, "дерево не изменилось");
  ctx.close();
});

test("граница: пустая группа перемещается как обычная сущность", () => {
  const { ctx } = scene({ timers: ["A", "B"], folders: [["F", []]] });
  assert.deepEqual(rootLabels(ctx), ["A", "B", "F"]);
  ctx.TreeController.move(idOfName(ctx, "F"), "up");
  assert.deepEqual(rootLabels(ctx), ["A", "F", "B"], "пустая папка поднялась");
  assert.equal(T(ctx).childrenOf(idOfName(ctx, "F")).length, 0, "осталась пустой");
  close(ctx.sumTargets(), 1, "сумма 1");
  ctx.close();
});

// =====================================================================
//  ТЗ 10 — синхронизация порядка
// =====================================================================

test("ТЗ 10.1: порядок узлов сериализуется в ключ «tree» (корень и вложенные)", () => {
  const { ctx } = scene({ timers: ["A", "B", "C", "D"], folders: [["F", ["B", "C"]]] });
  ctx.TreeController.move(idOfName(ctx, "F"), "up");
  const raw = ctx.window.localStorage.getItem("tree");
  assert.ok(raw, "ключ tree записан");
  const tree = JSON.parse(raw);
  assert.deepEqual(
    tree.map(n => (n.k === "f" ? n.name : timerName(ctx, n.id))),
    rootLabels(ctx),
    "порядок корня совпадает с моделью"
  );
  const folderNode = tree.find(n => n.k === "f");
  assert.deepEqual(
    folderNode.children.map(n => timerName(ctx, n.id)),
    ["B", "C"],
    "порядок внутри папки сериализован"
  );
  ctx.close();
});

test("ТЗ 10.1: ключ «tree» входит в CloudSync.STATE_KEYS", () => {
  const { ctx } = scene({ timers: ["A"] });
  assert.ok(
    [...ctx.CloudSync.STATE_KEYS].includes("tree"),
    "tree синхронизируется между устройствами"
  );
  assert.ok([...ctx.CloudSync.STATE_KEYS].includes("timers"), "timers по-прежнему синхронизируются");
  ctx.close();
});

test("ТЗ 10.1: перестановка узлов — осмысленное изменение (дерево в проекции без сортировки)", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  ctx.StorageService.saveToLocalStorage();
  const snapBefore = ctx.CloudSync.snapshotLocal();
  const projBefore = ctx.CloudSync.meaningfulProjection(snapBefore);
  const hashBefore = ctx.CloudSync.meaningfulHash(snapBefore);

  ctx.TreeController.move(idOfName(ctx, "A"), "down"); // только порядок изменился
  const snapAfter = ctx.CloudSync.snapshotLocal();

  assert.notEqual(
    ctx.CloudSync.meaningfulProjection(snapAfter),
    projBefore,
    "проекция изменилась — порядок разъедется по устройствам"
  );
  assert.notEqual(
    ctx.CloudSync.meaningfulHash(snapAfter),
    hashBefore,
    "хэш изменился"
  );
  assert.deepEqual(
    [...ctx.AppState.getTimers()].map(t => t.name).sort(),
    ["A", "B", "C"],
    "состав задач не изменился"
  );
  ctx.close();
});

test("ТЗ 10.1: порядок в списке «timers» проекцию не меняет — поэтому дерево отдельно", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  ctx.StorageService.saveToLocalStorage();
  const snap = ctx.CloudSync.snapshotLocal();
  const proj = ctx.CloudSync.meaningfulProjection(snap);

  const shuffled = {
    ...snap,
    timers: JSON.stringify([...JSON.parse(snap.timers)].reverse()),
  };
  assert.equal(
    ctx.CloudSync.meaningfulProjection(shuffled),
    proj,
    "список таймеров сортируется — перестановка в нём не видна"
  );
  // а вот перестановка дерева видна
  const tree = JSON.parse(snap.tree);
  const reordered = { ...snap, tree: JSON.stringify([tree[1], tree[0], tree[2]]) };
  assert.notEqual(
    ctx.CloudSync.meaningfulProjection(reordered),
    proj,
    "перестановка дерева видна в проекции"
  );
  ctx.close();
});

test("ТЗ 10.2: каждый клик стрелкой сразу синхронизируется", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  ctx.StorageService.saveToLocalStorage();
  const bumps = [];
  ctx.CloudSync.bumpControl = (...args) => {
    bumps.push(args);
    return 1;
  };
  const treeBefore = ctx.window.localStorage.getItem("tree");

  ctx.click(ctx.moveButton(byName(ctx, "A"), "down"));

  assert.equal(bumps.length, 1, "клик вызвал управляющую синхронизацию");
  const treeAfter = ctx.window.localStorage.getItem("tree");
  assert.notEqual(treeAfter, treeBefore, "новый порядок записан немедленно");
  assert.deepEqual(
    JSON.parse(treeAfter).map(n => timerName(ctx, n.id)),
    rootLabels(ctx),
    "в хранилище — текущий порядок"
  );
  ctx.close();
});

test("ТЗ 10.2: структурные изменения тоже синхронизируются сразу", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  const bumps = [];
  ctx.CloudSync.bumpControl = () => {
    bumps.push(1);
    return 1;
  };
  ctx.TreeController.createFolder("Новая");
  assert.equal(bumps.length, 1, "создание группы синхронизировано");
  ctx.TreeController.moveToFolder(idOfName(ctx, "A"), idOfName(ctx, "Новая"));
  assert.equal(bumps.length, 2, "перенос «В группу» синхронизирован");
  ctx.TreeController.deleteFolder(idOfName(ctx, "Новая"));
  assert.equal(bumps.length, 3, "удаление группы синхронизировано");
  ctx.close();
});

test("ТЗ 10.1: на «втором устройстве» порядок идентичен", () => {
  const first = scene(
    { timers: ["A", "B", "C", "D"], folders: [["F", ["B", "C"]], ["G", ["D"]]] },
    { shares: { A: 0.4, B: 0.3, C: 0.2, D: 0.1 } }
  );
  // на первом устройстве порядок переставили стрелками
  first.ctx.TreeController.move(idOfName(first.ctx, "F"), "up");
  first.ctx.TreeController.move(idOfName(first.ctx, "G"), "up");
  first.ctx.StorageService.saveToLocalStorage();

  const ls = first.ctx.window.localStorage;
  const dump = key => ls.getItem(key);

  const second = setup();
  ["timers", "tree", "globalEndTimeValue", "lastSessionEndTime"].forEach(key => {
    const value = dump(key);
    if (value !== null) second.window.localStorage.setItem(key, value);
  });
  second.StorageService.loadTimersFromLocalStorage();

  assert.deepEqual(treeLabels(second), treeLabels(first.ctx), "дерево то же");
  assert.deepEqual(domLabels(second), domLabels(first.ctx), "порядок на экране тот же");
  assert.deepEqual(
    second.flat().map(x => `${x.kind}:${x.depth}`),
    first.ctx.flat().map(x => `${x.kind}:${x.depth}`),
    "уровни вложенности те же"
  );
  ["A", "B", "C", "D"].forEach(name => {
    close(
      target(byName(second, name)),
      target(byName(first.ctx, name)),
      `цель ${name} на втором устройстве`
    );
    close(
      T(second).shareOf(idOfName(second, name)),
      T(first.ctx).shareOf(idOfName(first.ctx, name)),
      `доля ${name} на втором устройстве`
    );
  });
  second.close();
  first.ctx.close();
});

test("ТЗ 10.1: дерево, пришедшее из облака, заменяет локальный порядок", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"] });
  const remoteTree = JSON.stringify([
    { k: "t", id: byName(ctx, "C").id },
    {
      k: "f",
      id: 4242,
      name: "Из облака",
      children: [{ k: "t", id: byName(ctx, "A").id }],
    },
    { k: "t", id: byName(ctx, "B").id },
  ]);
  const sanitized = ctx.TreeModel.sanitizeTree(JSON.parse(remoteTree));
  ctx.AppState.tree = sanitized;
  ctx.TreeModel.ensureTimerNodes();
  ctx.TimerView.renderTree();

  assert.deepEqual(treeLabels(ctx), ["C", "Из облака", "  A", "B"], "порядок принят с сервера");
  assert.deepEqual(domLabels(ctx), treeLabels(ctx), "DOM соответствует");
  assert.equal(parentLabel(ctx, "A"), "Из облака", "A внутри принятой папки");
  assert.equal(T(ctx).findNode(byName(ctx, "B").id) !== null, true, "B не потеряна");
  ctx.close();
});

// =====================================================================
//  Регрессии хранилища и порядка
// =====================================================================

test("регрессия: порядок дерева сохраняется между «перезагрузками»", () => {
  const first = scene({ timers: ["A", "B", "C"], folders: [["F", ["B"]]] });
  first.ctx.TreeController.move(idOfName(first.ctx, "F"), "up");
  first.ctx.StorageService.saveToLocalStorage();
  const timers = first.ctx.window.localStorage.getItem("timers");
  const tree = first.ctx.window.localStorage.getItem("tree");
  const expected = treeLabels(first.ctx);

  const second = setup();
  second.window.localStorage.setItem("timers", timers);
  second.window.localStorage.setItem("tree", tree);
  second.StorageService.loadTimersFromLocalStorage();
  assert.deepEqual(treeLabels(second), expected, "порядок восстановлен");
  second.close();
  first.ctx.close();
});

test("регрессия: перемещения не ломают планы и подсчёт времени", () => {
  const { ctx } = scene(
    { timers: ["A", "B", "C"], folders: [["F", ["B", "C"]]] },
    { shares: { A: 0.5, B: 0.3, C: 0.2 } }
  );
  const totalBefore = ctx.TimeCalculator.getTotalTime();
  ctx.TreeController.move(idOfName(ctx, "F"), "up");
  ctx.TreeController.move(idOfName(ctx, "A"), "down");
  ctx.recomputePlans();

  close(ctx.totalPlanned(), totalBefore, "сумма планов = остаток сессии");
  ctx.AppState.getTimers().forEach(t => {
    assert.ok(t.plannedSeconds >= 0, `план ${t.name} неотрицателен`);
  });
  ctx.clock.advanceSec(300);
  ctx.tick();
  close(ctx.totalPlanned(), totalBefore - 300, "через 5 минут план уменьшился на 300 с");
  ctx.close();
});

test("регрессия: свёрнутая папка остаётся свёрнутой после перемещения", () => {
  const { ctx } = scene({ timers: ["A", "B", "C"], folders: [["F", ["B", "C"]]] });
  ctx.FolderView.toggleCollapsed(idOfName(ctx, "F"));
  assert.equal(ctx.FolderView.isCollapsed(idOfName(ctx, "F")), true, "свёрнута");

  ctx.TreeController.move(idOfName(ctx, "F"), "up");

  assert.equal(
    ctx.FolderView.isCollapsed(idOfName(ctx, "F")),
    true,
    "состояние сворачивания сохранено"
  );
  assert.equal(
    ctx.window.getComputedStyle(ctx.folderChildrenEl(idOfName(ctx, "F"))).display,
    "none",
    "содержимое по-прежнему скрыто"
  );
  // содержимое остаётся в DOM (скрытым) — так сворачивание не теряет карточки
  assert.deepEqual(domLabels(ctx), ["F", "  B", "  C", "A"], "дерево в DOM прежнее");
  assert.equal(ctx.isVisible(ctx.card(byName(ctx, "B"))), false, "B не видна");
  assert.equal(ctx.isVisible(ctx.card(byName(ctx, "C"))), false, "C не видна");
  assert.equal(
    ctx.isVisible(ctx.folderHeader(idOfName(ctx, "F"))),
    true,
    "шапка папки видна"
  );
  assert.equal(ctx.isVisible(ctx.card(byName(ctx, "A"))), true, "A видна");
  ctx.close();
});
