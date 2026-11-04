// Случайные (но воспроизводимые) сценарии для группировки по папкам
// (Требования-группы.md): сотни произвольных последовательностей операций
// проверяются на инварианты, которые обязаны выполняться ВСЕГДА, а не только
// в тщательно подобранных сценах:
//
//   - каждый таймер стоит в дереве ровно один раз, лишних узлов нет (раздел 2);
//   - сумма целей всех таймеров равна 1, значения конечны и лежат в [0, 1]
//     (3.2.1–3.2.3);
//   - сумма долей сиблингов уровня равна 1 (3.2.2);
//   - порядок карточек и папок в DOM совпадает с деревом (раздел 8);
//   - радиусы правок: доля — своя папка (3.6), цель — всё приложение (3.7),
//     перенос/перемещение не трогают цели (6.4, 9.5), удаление — только
//     ближайший родитель (7.2), создание внутри — только эта папка (5.3.4),
//     «+ Добавить таймер» — только корень, внутренние доли папок целы (5.4).
//
// Каждый запуск детерминирован: генератор случайных чисел зависит только от
// номера сценария. При падении сообщение содержит номер сценария, шаг и
// журнал операций — этого достаточно, чтобы воспроизвести ошибку.
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, DEFAULT_END } = require("./harness.js");

after(closeAll);

const EPS = 1e-9;
const SEEDS = Number(process.env.FUZZ_SEEDS || 24);
const STEPS = Number(process.env.FUZZ_STEPS || 45);

/** mulberry32 — маленький детерминированный ГСЧ. */
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

const fmt = n => Number(n).toFixed(6);

class World {
  constructor(seed) {
    this.seed = seed;
    this.rand = rng(seed * 7919 + 13);
    this.log = [];
    const ctx = (this.ctx = setup());
    const count = 2 + Math.floor(this.rand() * 3);
    const weights = Array.from({ length: count }, () => 1 + Math.floor(this.rand() * 4));
    const sum = weights.reduce((s, w) => s + w, 0);
    weights.forEach((w, i) =>
      ctx.addTimer({ name: `T${i}`, proportion: w / sum, targetProportion: w / sum })
    );
    ctx.setEndTime(DEFAULT_END);
    ctx.recomputePlans();
    ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
    this.counter = count;
  }
  pick(list) {
    return list[Math.floor(this.rand() * list.length)];
  }
  get T() {
    return this.ctx.TreeModel;
  }
  timers() {
    return Array.from(this.ctx.AppState.getTimers());
  }
  folders() {
    return Array.from(this.T.allFolderNodes());
  }
  /** Цели всех таймеров: id -> цель. */
  targets() {
    const out = new Map();
    this.timers().forEach(t => out.set(t.id, Number(t.targetProportion)));
    return out;
  }
  /** id таймеров в поддереве узла. */
  subtreeIds(node) {
    return new Set(Array.from(this.T.descendantTimerIds(node)));
  }
  rootNode() {
    return { k: "f", id: -1, children: this.T.root() };
  }
  /** Доли всех узлов внутри папки (id -> доля). */
  sharesInside(folderNode) {
    const out = new Map();
    const walk = nodes =>
      Array.from(nodes).forEach(n => {
        out.set(Number(n.id), this.T.shareOf(n.id));
        if (this.T.isFolder(n)) walk(n.children);
      });
    walk(folderNode.children);
    return out;
  }
  dump() {
    const lines = [];
    const walk = (nodes, depth) =>
      Array.from(nodes).forEach(n => {
        const pad = "  ".repeat(depth);
        if (this.T.isFolder(n)) {
          lines.push(`${pad}[${n.name}] цель=${fmt(this.T.nodeTarget(n))}`);
          walk(n.children, depth + 1);
        } else {
          const t = this.ctx.AppState.findTimerById(n.id);
          lines.push(`${pad}${t ? t.name : "?"} цель=${t ? fmt(t.targetProportion) : "?"}`);
        }
      });
    walk(this.T.root(), 0);
    return lines.join("\n  ");
  }
  fail(message) {
    const trail = this.log.slice(-8).join("\n  ");
    assert.fail(
      `[сценарий ${this.seed}] ${message}\n  журнал:\n  ${trail}\n  дерево:\n  ${this.dump()}`
    );
  }
  eq(actual, expected, what) {
    if (!(Math.abs(actual - expected) < 1e-7)) {
      this.fail(`${what}: ${fmt(actual)} != ${fmt(expected)}`);
    }
  }
}

// --- инварианты, которые проверяются после КАЖДОЙ операции ---------------
function checkGlobal(w) {
  const { ctx, T } = w;
  const timers = w.timers();
  const ids = timers.map(t => t.id);

  // 1. структура дерева ↔ модель
  const flat = Array.from(T.flatten());
  const treeTimerIds = flat.filter(x => x.kind === "timer").map(x => x.id);
  const treeFolderIds = flat.filter(x => x.kind === "folder").map(x => x.id);
  if (new Set(treeTimerIds).size !== treeTimerIds.length) w.fail("таймер в дереве дважды");
  if (new Set(treeFolderIds).size !== treeFolderIds.length) w.fail("папка в дереве дважды");
  if (
    [...treeTimerIds].sort().join() !== [...ids].sort().join()
  ) {
    w.fail(`дерево и таймеры разошлись: дерево ${treeTimerIds.length}, модель ${ids.length}`);
  }

  // 2. числа: конечные и в [0, 1]; сумма целей = 1
  let sum = 0;
  timers.forEach(t => {
    const v = Number(t.targetProportion);
    if (!Number.isFinite(v)) w.fail(`цель «${t.name}» не число`);
    if (v < -EPS || v > 1 + EPS) w.fail(`цель «${t.name}» вне [0, 1]: ${fmt(v)}`);
    const p = Number(t.proportion);
    if (!Number.isFinite(p) || p < -EPS) w.fail(`вес «${t.name}» некорректен: ${p}`);
    sum += v;
  });
  if (timers.length) w.eq(sum, 1, "сумма целей приложения");

  // 3. сумма долей каждого уровня
  const levels = [w.T.root(), ...w.folders().map(f => f.children)];
  levels.forEach(level => {
    const nodes = Array.from(level);
    if (!nodes.length) return;
    const levelSum = nodes.reduce((s, n) => s + T.nodeTarget(n), 0);
    const shares = nodes.reduce((s, n) => s + T.shareOf(n.id), 0);
    w.eq(shares, levelSum > 0 ? 1 : 0, "сумма долей уровня");
  });

  // 4. порядок в DOM = порядок дерева
  const dom = [];
  const walk = host =>
    Array.from(host.children).forEach(el => {
      if (el.classList.contains("folder-node")) {
        dom.push(`f${el.getAttribute("data-folder-id")}`);
        walk(ctx.folderChildrenEl(Number(el.getAttribute("data-folder-id"))));
      } else if (el.id.startsWith("timer-")) {
        dom.push(`t${el.id.slice(6)}`);
      }
    });
  walk(ctx.document.getElementById("timersContainer"));
  const expected = flat.map(x => `${x.kind === "folder" ? "f" : "t"}${x.id}`);
  if (dom.join() !== expected.join()) {
    w.fail(`порядок в DOM не совпал с деревом:\n    DOM ${dom.join(" ")}\n    дерево ${expected.join(" ")}`);
  }

  // 5. никаких NaN/undefined в видимых текстах карточек
  timers.forEach(t => {
    const text = ctx.card(t).textContent;
    if (/NaN|undefined|Infinity/.test(text)) w.fail(`в карточке «${t.name}» мусор: ${text.slice(0, 120)}`);
  });
}

// --- операции ----------------------------------------------------------
const OPS = {
  addRoot(w) {
    const before = w.targets();
    const folders = w.folders();
    const innerBefore = new Map(folders.map(f => [f.id, w.sharesInside(f)]));
    const p = 0.05 + w.rand() * 0.8;
    const name = `R${w.counter++}`;
    w.log.push(`addRoot ${name} p=${fmt(p)}`);
    const first = !before.size;
    const created = w.ctx.AppController.addNewTimer(name, p);
    const after = w.targets();
    // первая задача приложения получает всё (цель 1), остальные — долю p
    w.eq(after.get(created.id), first ? 1 : p, "цель новой корневой задачи");
    // ужаты только корневые сиблинги, всё содержимое — в одно и то же число раз
    before.forEach((v, id) => w.eq(after.get(id), v * (1 - p), "ужатие существующих"));
    folders.forEach(f => {
      const now = w.sharesInside(f);
      innerBefore.get(f.id).forEach((s, id) => w.eq(now.get(id), s, "внутренние доли папки"));
    });
    w.ctx.AppState.setLastUpdateTime(new Date(w.ctx.clock.now));
  },
  addInFolder(w) {
    const folders = w.folders();
    if (!folders.length) return;
    const f = w.pick(folders);
    const before = w.targets();
    const inside = w.subtreeIds(f);
    const folderSum = w.T.nodeTarget(f);
    const sharesBefore = w.sharesInside(f);
    const p = 0.05 + w.rand() * 0.8;
    const name = `I${w.counter++}`;
    w.log.push(`addInFolder ${f.name}#${f.id} ${name} p=${fmt(p)}`);
    const created = w.ctx.AppController.createTaskInFolder(f.id, name, p);
    const after = w.targets();
    before.forEach((v, id) => {
      if (!inside.has(id)) w.eq(after.get(id), v, "вне папки ничего не меняется");
    });
    w.eq(w.T.nodeTarget(f), folderSum, "сумма папки не меняется");
    w.eq(after.get(created.id), p * folderSum, "цель новой задачи в папке");
    // прямые дети ужаты равномерно: доля каждого = прежняя * (1 - p)
    if (folderSum > 0) {
      sharesBefore.forEach((s, id) => {
        const par = w.T.parentOf(id);
        if (par && Number(par.id) === Number(f.id)) {
          w.eq(w.T.shareOf(id), s * (1 - p), "доля прежнего ребёнка");
        }
      });
    }
    w.ctx.AppState.setLastUpdateTime(new Date(w.ctx.clock.now));
  },
  newFolder(w) {
    const folders = w.folders();
    const parent = folders.length && w.rand() < 0.4 ? w.pick(folders) : null;
    const before = w.targets();
    w.log.push(`newFolder parent=${parent ? parent.id : "root"}`);
    w.ctx.TreeController.createFolder(`F${w.counter++}`, parent);
    const after = w.targets();
    before.forEach((v, id) => w.eq(after.get(id), v, "новая папка не меняет цели"));
  },
  moveTo(w) {
    const nodes = Array.from(w.T.flatten());
    if (!nodes.length) return;
    const node = w.pick(nodes);
    const folders = w.folders().filter(f => w.T.canMoveInto(node.id, f.id));
    const dest = folders.length && w.rand() < 0.8 ? w.pick(folders) : null;
    const before = w.targets();
    w.log.push(`moveTo ${node.kind}#${node.id} -> ${dest ? dest.id : "root"}`);
    w.ctx.TreeController.moveToFolder(node.id, dest ? dest.id : null);
    const after = w.targets();
    before.forEach((v, id) => w.eq(after.get(id), v, "перенос не меняет цели"));
  },
  arrow(w) {
    const nodes = Array.from(w.T.flatten());
    if (!nodes.length) return;
    const node = w.pick(nodes);
    const dir = w.rand() < 0.5 ? "up" : "down";
    const before = w.targets();
    w.log.push(`arrow ${node.kind}#${node.id} ${dir}`);
    const btn = w.ctx.moveButton(node.id, dir);
    w.ctx.click(btn);
    const after = w.targets();
    before.forEach((v, id) => w.eq(after.get(id), v, "стрелки не меняют цели"));
  },
  shareEdit(w) {
    const timers = w.timers().filter(t => {
      const loc = w.T.findNode(t.id);
      return loc && loc.siblings.length > 1;
    });
    if (!timers.length) return;
    const t = w.pick(timers);
    const loc = w.T.findNode(t.id);
    const scope = loc.parent ? loc.parent : w.rootNode();
    const inside = w.subtreeIds(scope);
    const before = w.targets();
    const levelSum = w.T.levelSumNodes(loc.siblings);
    const p = Math.round(w.rand() * 100) / 100;
    w.log.push(`shareEdit ${t.name} -> ${p}`);
    const input = w.ctx.shareInput(t.id);
    input.value = String(p);
    w.ctx.change(input);
    const after = w.targets();
    before.forEach((v, id) => {
      if (!inside.has(id)) w.eq(after.get(id), v, "вне своей папки доля ничего не меняет");
    });
    const loc2 = w.T.findNode(t.id);
    w.eq(w.T.levelSumNodes(loc2.siblings), levelSum, "сумма уровня при правке доли");
    // если сиблинги — одни пустые папки, принять долю некому: таймер держит всё
    const canGive = Array.from(loc.siblings).some(n => n !== loc.node && w.T.canAbsorb(n));
    if (levelSum > 0) w.eq(w.T.shareOf(t.id), canGive ? p : 1, "доля после правки");
  },
  targetEdit(w) {
    const timers = w.timers();
    if (timers.length < 2) return;
    const t = w.pick(timers);
    const before = w.targets();
    const raw = w.pick([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.7, -0.3]);
    const v = Math.min(1, Math.max(0, raw));
    w.log.push(`targetEdit ${t.name} -> ${raw}`);
    const input = w.ctx.elementOf(t.id, "target");
    input.value = String(raw);
    w.ctx.change(input);
    const after = w.targets();
    w.eq(after.get(t.id), v, "цель после правки (с обрезкой)");
    // остальные — в одно и то же число раз
    const factors = [];
    before.forEach((b, id) => {
      if (id !== t.id && b > EPS) factors.push(after.get(id) / b);
    });
    factors.forEach(f => w.eq(f, factors[0], "общий множитель остальных"));
  },
  deleteTimer(w) {
    const timers = w.timers();
    if (!timers.length) return;
    const t = w.pick(timers);
    const loc = w.T.findNode(t.id);
    const parent = loc.parent;
    const scope = parent ? parent : w.rootNode();
    const inside = w.subtreeIds(scope);
    const before = w.targets();
    const scopeSum = w.T.nodeTarget(scope);
    const remaining = Array.from(loc.siblings).filter(
      n => n !== loc.node && w.T.canAbsorb(n)
    );
    w.log.push(`deleteTimer ${t.name}`);
    w.ctx.click(w.ctx.card(t).querySelector('button[data-action="delete"]'));
    const after = w.targets();
    // если в группе принять освободившееся некому (или это последний таймер
    // приложения), перерасчёт законно уходит выше — локальность не проверяем
    if (remaining.length && w.timers().length) {
      before.forEach((v, id) => {
        if (id !== t.id && !inside.has(id)) w.eq(after.get(id), v, "удаление не выходит за группу");
      });
      if (parent) w.eq(w.T.nodeTarget(parent), scopeSum, "сумма группы сохраняется");
    }
  },
  deleteFolder(w) {
    const folders = w.folders();
    if (!folders.length) return;
    const f = w.pick(folders);
    const loc = w.T.findNode(f.id);
    const gone = w.subtreeIds(f);
    const parent = loc.parent;
    const scope = parent ? parent : w.rootNode();
    const before = w.targets();
    const remaining = Array.from(loc.siblings).filter(
      n => n !== loc.node && w.T.canAbsorb(n)
    );
    w.log.push(`deleteFolder ${f.name}#${f.id} (${gone.size} задач)`);
    const btn = w.ctx.folderHeader(f.id).querySelector('[data-action="delete-folder"]');
    w.ctx.click(btn);
    const after = w.targets();
    gone.forEach(id => {
      if (after.has(id)) w.fail("задача удалённой папки осталась");
    });
    if (remaining.length && w.timers().length) {
      const inside = w.subtreeIds(scope);
      before.forEach((v, id) => {
        if (!gone.has(id) && !inside.has(id)) w.eq(after.get(id), v, "удаление папки не выходит за уровень");
      });
    }
  },
  split(w) {
    const timers = w.timers();
    if (!timers.length) return;
    const t = w.pick(timers);
    const before = w.targets();
    const n = 2 + Math.floor(w.rand() * 2);
    const specs = Array.from({ length: n }, (_, i) => ({
      name: `${t.name}.${i}`,
      share: 1 + Math.floor(w.rand() * 3),
    }));
    const total = specs.reduce((s, x) => s + x.share, 0);
    w.log.push(`split ${t.name} на ${n}`);
    const kids = w.ctx.AppController.splitTimer(t.id, specs, "");
    const after = w.targets();
    before.forEach((v, id) => {
      if (id !== t.id) w.eq(after.get(id), v, "разбиение не трогает соседей");
    });
    kids.forEach((kid, i) =>
      w.eq(after.get(kid.id), before.get(t.id) * (specs[i].share / total), "цель подзадачи")
    );
    const folderOf = w.T.parentOf(kids[0].id);
    if (!folderOf || folderOf.name !== t.name) {
      w.fail(`имя папки по умолчанию должно совпасть с именем таймера «${t.name}»`);
    }
    w.ctx.AppState.setLastUpdateTime(new Date(w.ctx.clock.now));
  },
  rename(w) {
    const folders = w.folders();
    if (!folders.length) return;
    const f = w.pick(folders);
    const name = `N${w.counter++}`;
    w.log.push(`rename ${f.id} -> ${name}`);
    const input = w.ctx.document.getElementById(`folder-name-${f.id}`);
    input.value = name;
    w.ctx.change(input);
    if (w.T.folderName(f.id) !== name) w.fail("переименование не применилось");
  },
};

const WEIGHTED = [
  ["addRoot", 3],
  ["addInFolder", 4],
  ["newFolder", 3],
  ["moveTo", 5],
  ["arrow", 8],
  ["shareEdit", 5],
  ["targetEdit", 4],
  ["deleteTimer", 3],
  ["deleteFolder", 2],
  ["split", 3],
  ["rename", 1],
];
const BAG = WEIGHTED.flatMap(([name, n]) => Array(n).fill(name));

for (let seed = 1; seed <= SEEDS; seed++) {
  if (process.env.FUZZ_ONLY && Number(process.env.FUZZ_ONLY) !== seed) continue;
  test(`случайный сценарий №${seed}: инварианты дерева выполняются после каждой операции`, () => {
    const w = new World(seed);
    try {
      checkGlobal(w);
      for (let step = 0; step < STEPS; step++) {
        const name = w.pick(BAG);
        OPS[name](w);
        checkGlobal(w);
        // пустое приложение — повод начать заново, а не конец сценария
        if (!w.timers().length) OPS.addRoot(w);
      }
    } finally {
      w.ctx.close();
    }
  });
}
