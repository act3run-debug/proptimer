// Случайные сценарии «Конструктора дня»: произвольные операции на основном
// экране и сохранения из окна вперемешку. Инварианты, которые обязаны
// выполняться всегда (разделы 3, 5, 11, 12, 13 Требований):
//
//   - расписание, выведенное из основного экрана, не содержит конфликтов:
//     ни пересечений, ни свободного времени внутри групп (13.5, 13.17);
//   - промежуток один или его нет, а «Начало» = «Конец» ⇔ промежутка нет (13.4, 13.12);
//   - сумма длительностей верхнего уровня равна длительности расписания,
//     содержимое группы заполняет её интервал целиком (13.3, 13.5);
//   - Σ Целей = 1 после любых сохранений (13.2);
//   - «Начало»/«Конец» не меняются от событий основного экрана (11.2, 11.3.3, 12.2);
//   - повторное сохранение того, что показало окно, почти не меняет Цели
//     (в пределах округления до минуты, 10.3).
//
// Генератор детерминирован: сценарий определяется номером.
// Запуск:  npm test     (node --test); больше сценариев — DD_FUZZ_SEEDS=100
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll } = require("./harness.js");

after(closeAll);

const SEEDS = Number(process.env.DD_FUZZ_SEEDS || 20);
const STEPS = Number(process.env.DD_FUZZ_STEPS || 30);
const hm = t => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

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

class World {
  constructor(seed) {
    this.seed = seed;
    this.rand = rng(seed * 7717 + 3);
    this.log = [];
    this.counter = 0;
    const ctx = (this.ctx = setup());
    const n = 3 + Math.floor(this.rand() * 3);
    for (let i = 0; i < n; i++) {
      ctx.addTimer({ name: `T${i}`, proportion: 1 / n, targetProportion: 1 / n });
    }
    this.counter = n;
    ctx.setEndTime("12:00");
    // стартовое расписание: с промежутком или на сутки
    const d = ctx.DayDraft.fromMain();
    const names = ctx.AppState.getTimers().map(t => t.name);
    const gap = this.rand() < 0.6;
    const unit = gap ? 60 + Math.floor(this.rand() * 4) * 30 : Math.floor(1440 / n);
    let cur = Math.floor(this.rand() * 24) * 60;
    this.start0 = cur;
    names.forEach((name, i) => {
      const len = !gap && i === n - 1 ? 1440 - unit * (n - 1) : unit;
      const node = d.all().find(x => x.name === name);
      d.setTime(node.id, cur % 1440, ctx.ScheduleModel.normEnd(cur + len));
      cur += len;
    });
    this.gap = gap;
    const res = d.commit();
    if (!res.ok) throw new Error(`стартовое расписание не сохранилось: ${JSON.stringify(res.errors)}`);
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
  fail(msg) {
    assert.fail(`[сценарий ${this.seed}] ${msg}\n  журнал:\n  ${this.log.slice(-8).join("\n  ")}`);
  }
}

function sched(w) {
  return w.ctx.AppState.getSchedule();
}

/** Проверки выведенного расписания. */
function check(w) {
  const { ctx } = w;
  const SM = ctx.ScheduleModel;
  const timers = w.timers();
  if (!timers.length) return;
  const sum = timers.reduce((s, t) => s + Number(t.targetProportion), 0);
  if (Math.abs(sum - 1) > 1e-7) w.fail(`Σ Целей = ${sum}`);
  const lay = SM.layout();
  const D = SM.dur(sched(w).start, sched(w).end);
  // сумма верхнего уровня = D, содержимое группы заполняет её интервал
  const rootSum = Array.from(lay.root).reduce((s, e) => s + e.d, 0);
  if (Math.abs(rootSum - D) > 1e-6) w.fail(`Σ верхнего уровня ${rootSum} ≠ D ${D}`);
  w.folders().forEach(f => {
    const entry = lay.map.get(Number(f.id));
    const kids = Array.from(f.children)
      .map(c => lay.map.get(Number(c.id)))
      .filter(Boolean);
    if (!entry) return;
    const s = kids.reduce((acc, k) => acc + k.d, 0);
    if (Math.abs(s - entry.d) > 1e-6) w.fail(`группа «${f.name}»: содержимое ${s} ≠ ${entry.d}`);
  });
  // окно: конфликтов нет, если все интервалы длиннее минуты (округление)
  const draft = ctx.DayDraft.fromMain();
  const tooShort = Array.from(lay.map.values()).some(e => e.d > 0 && e.d < 1.6);
  const an = draft.analyze();
  if (!tooShort) {
    if (an.errors.length) {
      w.fail(`в окне конфликты: ${Array.from(an.errors.map(e => e.text)).join("; ")}`);
    }
    const hasGap = Math.round(sched(w).start) !== Math.round(sched(w).end);
    const timedRoot = Array.from(draft.children(null)).filter(n => draft.timed(n));
    if (timedRoot.length && hasGap && an.gapCount !== 1) w.fail(`ожидался 1 промежуток, найдено ${an.gapCount}`);
    if (timedRoot.length && !hasGap && an.gapCount !== 0) w.fail(`ожидалось без промежутка, найдено ${an.gapCount}`);
  }
}

const OPS = {
  addRoot(w) {
    const before = [sched(w).start, sched(w).end];
    const p = 0.05 + w.rand() * 0.6;
    w.log.push(`addRoot p=${p.toFixed(3)}`);
    w.ctx.AppController.addNewTimer(`R${w.counter++}`, p);
    w.ctx.AppState.setLastUpdateTime(new Date(w.ctx.clock.now));
    return before;
  },
  addZero(w) {
    const before = [sched(w).start, sched(w).end];
    w.log.push("addRoot p=0");
    w.ctx.AppController.addNewTimer(`Z${w.counter++}`, 0);
    return before;
  },
  addInFolder(w) {
    const folders = w.folders();
    if (!folders.length) return null;
    const f = w.pick(folders);
    const before = [sched(w).start, sched(w).end];
    w.log.push(`addInFolder ${f.name}`);
    w.ctx.AppController.createTaskInFolder(f.id, `I${w.counter++}`, 0.1 + w.rand() * 0.5);
    return before;
  },
  newFolder(w) {
    const before = [sched(w).start, sched(w).end];
    w.log.push("newFolder");
    w.ctx.TreeController.createFolder(`F${w.counter++}`, null);
    return before;
  },
  moveTo(w) {
    const nodes = Array.from(w.T.flatten());
    const folders = w.folders();
    if (!nodes.length || !folders.length) return null;
    const node = w.pick(nodes);
    const f = w.pick(folders);
    const before = [sched(w).start, sched(w).end];
    w.log.push(`moveTo ${node.kind}#${node.id} -> ${f.name}`);
    w.ctx.TreeController.moveToFolder(node.id, f.id);
    return before;
  },
  targetEdit(w) {
    const timers = w.timers();
    if (timers.length < 2) return null;
    const t = w.pick(timers);
    const v = w.pick([0, 0.1, 0.3, 0.5, 0.8]);
    const before = [sched(w).start, sched(w).end];
    w.log.push(`target ${t.name} -> ${v}`);
    const input = w.ctx.elementOf(t.id, "target");
    input.value = String(v);
    w.ctx.change(input);
    return before;
  },
  shareEdit(w) {
    const cand = w.timers().filter(t => {
      const loc = w.T.findNode(t.id);
      return loc && loc.siblings.length > 1;
    });
    if (!cand.length) return null;
    const t = w.pick(cand);
    const before = [sched(w).start, sched(w).end];
    const p = Math.round(w.rand() * 100) / 100;
    w.log.push(`share ${t.name} -> ${p}`);
    const input = w.ctx.shareInput(t.id);
    input.value = String(p);
    w.ctx.change(input);
    return before;
  },
  deleteTimer(w) {
    const timers = w.timers();
    if (timers.length < 2) return null;
    const t = w.pick(timers);
    const before = [sched(w).start, sched(w).end];
    w.log.push(`deleteTimer ${t.name}`);
    w.ctx.click(w.ctx.card(t).querySelector('button[data-action="delete"]'));
    return before;
  },
  deleteFolder(w) {
    const folders = w.folders();
    if (!folders.length || w.timers().length < 3) return null;
    const f = w.pick(folders);
    const inside = w.T.descendantTimerIds(f).length;
    if (inside >= w.timers().length) return null;
    const before = [sched(w).start, sched(w).end];
    w.log.push(`deleteFolder ${f.name}`);
    w.ctx.click(w.ctx.folderHeader(f.id).querySelector('[data-action="delete-folder"]'));
    return before;
  },
  split(w) {
    const timers = w.timers().filter(t => Number(t.targetProportion) > 0.02);
    if (!timers.length) return null;
    const t = w.pick(timers);
    const before = [sched(w).start, sched(w).end];
    w.log.push(`split ${t.name}`);
    w.ctx.AppController.splitTimer(
      t.id,
      [{ name: `${t.name}a`, share: 1 }, { name: `${t.name}b`, share: 1 + Math.floor(w.rand() * 3) }],
      ""
    );
    return before;
  },
  arrows(w) {
    const nodes = Array.from(w.T.flatten());
    if (!nodes.length) return null;
    const node = w.pick(nodes);
    const before = [sched(w).start, sched(w).end];
    w.log.push(`arrow #${node.id}`);
    w.ctx.click(w.ctx.moveButton(node.id, w.rand() < 0.5 ? "up" : "down"));
    return before;
  },
  endEdit(w) {
    // ручная правка «Конца» на основном экране (3.4, 5.8): с промежутком —
    // монолитный сдвиг (D не меняется), без него — прилипание к концу активности
    const SM = w.ctx.ScheduleModel;
    const sc = sched(w);
    const gap = Math.round(sc.start) !== Math.round(sc.end);
    const D = SM.dur(sc.start, sc.end);
    const targets = w.timers().map(t => Number(t.targetProportion));
    const v = Math.floor(w.rand() * 1440);
    w.log.push(`endEdit -> ${SM.fmtStart(v)} (промежуток: ${gap})`);
    w.ctx.setEndTime(SM.fmtStart(v));
    w.ctx.ScheduleModel.onEndFieldCommitted();
    const after = sched(w);
    if (gap) {
      if (Math.abs(SM.dur(after.start, after.end) - D) > 1e-6) {
        w.fail("размер расписания изменился при сдвиге");
      }
      if (after.end !== v) w.fail("«Конец» не принят как введён");
    } else if (after.start !== after.end) {
      w.fail("без промежутка «Начало» и «Конец» должны совпадать");
    }
    w.timers().forEach((t, i) => {
      if (Number(t.targetProportion) !== targets[i]) w.fail("Цели изменились правкой «Конца»");
    });
    return null;
  },
  resave(w) {
    // открыть окно и сохранить без правок: Цели меняются только в пределах минуты
    const timers = w.timers();
    const lay = w.ctx.ScheduleModel.layout();
    if (Array.from(lay.map.values()).some(e => e.d > 0 && e.d < 1.6)) return null;
    const D = w.ctx.ScheduleModel.dur(sched(w).start, sched(w).end);
    const before = new Map(timers.map(t => [t.id, Number(t.targetProportion)]));
    w.log.push("resave");
    const draft = w.ctx.DayDraft.fromMain();
    const res = draft.commit();
    if (!res.ok) w.fail(`сохранение без правок отклонено: ${res.errors.map(e => e.text).join("; ")}`);
    w.timers().forEach(t => {
      const was = before.get(t.id);
      if (was === undefined) return;
      if (Math.abs(Number(t.targetProportion) - was) > 1.01 / D + 1e-9) {
        w.fail(`Цель ${t.name} изменилась ${was} → ${t.targetProportion} (D=${D} мин)`);
      }
    });
    return null;
  },
};

const BAG = [
  ...Array(3).fill("addRoot"),
  "addZero",
  ...Array(2).fill("addInFolder"),
  ...Array(2).fill("newFolder"),
  ...Array(3).fill("moveTo"),
  ...Array(3).fill("targetEdit"),
  ...Array(3).fill("shareEdit"),
  ...Array(2).fill("deleteTimer"),
  "deleteFolder",
  ...Array(2).fill("split"),
  ...Array(2).fill("arrows"),
  ...Array(2).fill("endEdit"),
  ...Array(2).fill("resave"),
];

for (let seed = 1; seed <= SEEDS; seed++) {
  test(`случайный сценарий «Конструктора» №${seed}: расписание всегда согласовано с основным экраном`, () => {
    const w = new World(seed);
    try {
      check(w);
      for (let step = 0; step < STEPS; step++) {
        const name = w.pick(BAG);
        const before = OPS[name](w);
        if (before) {
          const now = [sched(w).start, sched(w).end];
          if (now[0] !== before[0] || now[1] !== before[1]) {
            w.fail(`«Начало»/«Конец» изменились событием основного экрана: ${before} → ${now}`);
          }
        }
        check(w);
        if (w.timers().length < 2) OPS.addRoot(w);
      }
    } finally {
      w.ctx.close();
    }
  });
}
