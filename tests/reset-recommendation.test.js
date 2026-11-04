// Регрессия: после «Сброса» «Рекомендация» должна пересчитываться.
//
// Баг (найден пользователем): «Факт» введён вручную на двух таймерах, затем
// очищен кнопкой «Сброс» — «Рекомендация» при этом не обновлялась и
// показывала значения, посчитанные по уже отменённому «Факту».
//
// Причина: автообновление (AppController.autoUpdate) срабатывает в начале
// КАЖДОГО клика, ДО целевого действия, поэтому рекомендации считались по
// «Факту» до сброса, а сам сброс их уже не пересчитывал (в отличие от ручного
// ввода «Факта»/«Всего» и кнопки «Обновить»).
//
// Запуск:  npm test     (node --test)
"use strict";

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, closeAll, DEFAULT_END } = require("./harness.js");

after(closeAll);

const MIN = 60;
const EPS = 1e-9;

/** Два таймера с равными целями + «Конец» через 2 часа. */
function scene(opts = {}) {
  const ctx = setup(opts);
  const a = ctx.addTimer({ name: "A", proportion: 0.5, targetProportion: 0.5 });
  const b = ctx.addTimer({ name: "B", proportion: 0.5, targetProportion: 0.5 });
  ctx.setEndTime(DEFAULT_END);
  ctx.recomputePlans();
  ctx.AppState.setLastUpdateTime(new Date(ctx.clock.now));
  return { ctx, a, b };
}

/** Число из текста «Рекомендация: 0.5454…». */
const recText = (ctx, t) => {
  const m = /([\d.]+)\s*$/.exec(ctx.cardText(t, "recommendation"));
  return m ? Number(m[1]) : NaN;
};
const prioText = (ctx, t) => Number(/\d+/.exec(ctx.cardText(t, "priority"))[0]);

/** Ввод «Факт вручную» через настоящие поля и кнопку «Применить» карточки. */
function enterFact(ctx, timer, seconds) {
  const card = ctx.card(timer);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  card.querySelector('input[data-type="tracked-hours"]').value = h;
  card.querySelector('input[data-type="tracked-minutes"]').value = m;
  card.querySelector('input[data-type="tracked-seconds"]').value = s;
  ctx.click(card.querySelector('button[data-action="apply-tracked"]'));
}
const clickReset = (ctx, timer) =>
  ctx.click(ctx.card(timer).querySelector('button[data-action="reset"]'));

/** Эталон: что покажет полный пересчёт «с нуля» при текущем состоянии. */
function freshRecommendations(ctx) {
  ctx.AppController.calculateRecommendations();
  return ctx.AppState.getTimers().map(t => [t, recText(ctx, t), prioText(ctx, t)]);
}

test("баг: «Факт» введён на двух таймерах, «Сброс» одного — рекомендации обновляются", () => {
  const { ctx, a, b } = scene();
  enterFact(ctx, a, 40 * MIN);
  enterFact(ctx, b, 10 * MIN);
  assert.equal(a.trackedSeconds, 40 * MIN);
  assert.equal(b.trackedSeconds, 10 * MIN);
  const staleA = recText(ctx, a);
  const staleB = recText(ctx, b);

  clickReset(ctx, a);
  assert.equal(a.trackedSeconds, 0);

  const shownA = recText(ctx, a);
  const shownB = recText(ctx, b);
  assert.notEqual(shownA, staleA, "«Рекомендация» A должна измениться после сброса");
  assert.notEqual(shownB, staleB, "«Рекомендация» B тоже зависит от общего остатка");
  // то, что на экране, совпадает со свежим полным пересчётом
  const fresh = freshRecommendations(ctx);
  assert.ok(Math.abs(shownA - fresh[0][1]) < 1e-6, `A: ${shownA} vs ${fresh[0][1]}`);
  assert.ok(Math.abs(shownB - fresh[1][1]) < 1e-6, `B: ${shownB} vs ${fresh[1][1]}`);
  ctx.close();
});

test("баг: «Сброс» обоих таймеров возвращает рекомендации к исходным", () => {
  const { ctx, a, b } = scene();
  ctx.AppController.calculateRecommendations();
  const startA = recText(ctx, a);
  const startB = recText(ctx, b);
  enterFact(ctx, a, 40 * MIN);
  enterFact(ctx, b, 10 * MIN);
  assert.notEqual(recText(ctx, a), startA, "после ввода «Факта» рекомендации иные");
  clickReset(ctx, a);
  clickReset(ctx, b);
  assert.equal(a.trackedSeconds, 0);
  assert.equal(b.trackedSeconds, 0);
  assert.ok(Math.abs(recText(ctx, a) - startA) < 1e-6, `A: ${recText(ctx, a)} vs ${startA}`);
  assert.ok(Math.abs(recText(ctx, b) - startB) < 1e-6, `B: ${recText(ctx, b)} vs ${startB}`);
  // при равных целях и нулевом «Факте» рекомендации поровну
  assert.ok(Math.abs(recText(ctx, a) - 0.5) < 1e-6);
  assert.ok(Math.abs(recText(ctx, b) - 0.5) < 1e-6);
  ctx.close();
});

test("баг: рекомендация в модели и на экране совпадают сразу после «Сброса»", () => {
  const { ctx, a, b } = scene();
  enterFact(ctx, a, 30 * MIN);
  enterFact(ctx, b, 5 * MIN);
  clickReset(ctx, b);
  [a, b].forEach(t => {
    assert.ok(
      Math.abs(recText(ctx, t) - t.recommendedProportion) < 1e-9,
      `${t.name}: экран ${recText(ctx, t)} / модель ${t.recommendedProportion}`
    );
  });
  ctx.close();
});

test("баг: «Приоритет» тоже пересчитывается после «Сброса»", () => {
  const { ctx, a, b } = scene();
  enterFact(ctx, a, 40 * MIN);
  enterFact(ctx, b, 10 * MIN);
  assert.equal(prioText(ctx, b), 1, "пока A «перевыполнена», приоритетнее B");
  clickReset(ctx, a);
  // теперь «Факт» только у B, значит A отстаёт сильнее — она первая
  assert.equal(prioText(ctx, a), 1, "после сброса A стала приоритетнее");
  assert.equal(prioText(ctx, b), 2);
  freshRecommendations(ctx).forEach(([t, , prio]) => assert.equal(prioText(ctx, t), prio));
  ctx.close();
});

test("баг: «Сброс» таймера внутри папки пересчитывает рекомендации всех таймеров", () => {
  const { ctx, a, b } = scene();
  const f = ctx.addFolder("Группа");
  ctx.moveToFolder(a.id, f.id);
  ctx.moveToFolder(b.id, f.id);
  enterFact(ctx, a, 40 * MIN);
  enterFact(ctx, b, 10 * MIN);
  const staleB = recText(ctx, b);
  clickReset(ctx, a);
  assert.notEqual(recText(ctx, b), staleB);
  const fresh = freshRecommendations(ctx);
  fresh.forEach(([t, rec]) => assert.ok(Math.abs(recText(ctx, t) - rec) < 1e-6));
  ctx.close();
});

test("баг: «Сброс» работающего таймера пересчитывает рекомендации и не ломает отсчёт", () => {
  const { ctx, a, b } = scene();
  enterFact(ctx, b, 10 * MIN);
  ctx.TimerController.toggleTracking(a.id);
  ctx.clock.advanceSec(15 * MIN);
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 15 * MIN) < EPS);
  clickReset(ctx, a);
  assert.equal(a.isTracking, true, "отсчёт продолжается");
  assert.ok(a.trackedSeconds < 1, "«Факт» обнулён");
  const shown = [recText(ctx, a), recText(ctx, b)];
  const staleShown = shown.slice();
  const fresh = freshRecommendations(ctx);
  fresh.forEach(([, rec], i) =>
    assert.ok(Math.abs(staleShown[i] - rec) < 1e-6, `экран ${staleShown[i]} vs пересчёт ${rec}`)
  );
  ctx.clock.advanceSec(60);
  ctx.tick();
  assert.ok(Math.abs(a.trackedSeconds - 60) < 1e-6, "после сброса «Факт» растёт с нуля");
  ctx.close();
});

test("баг: в облако после «Сброса» уходит уже пересчитанная рекомендация", () => {
  const { ctx, a, b } = scene();
  enterFact(ctx, a, 40 * MIN);
  enterFact(ctx, b, 10 * MIN);
  const seen = [];
  const original = ctx.CloudSync.bumpControl;
  ctx.CloudSync.bumpControl = (...args) => {
    seen.push([a.recommendedProportion, b.recommendedProportion]);
    return original.apply(ctx.CloudSync, args);
  };
  clickReset(ctx, a);
  assert.ok(seen.length >= 1, "сброс отправляет состояние в облако");
  const last = seen[seen.length - 1];
  const fresh = freshRecommendations(ctx);
  assert.ok(Math.abs(last[0] - fresh[0][0].recommendedProportion) < 1e-9);
  assert.ok(Math.abs(last[1] - fresh[1][0].recommendedProportion) < 1e-9);
  ctx.close();
});

test("«Сброс» нулевого «Факта» безвреден: рекомендации не меняются", () => {
  const { ctx, a, b } = scene();
  ctx.AppController.calculateRecommendations();
  const before = [recText(ctx, a), recText(ctx, b)];
  clickReset(ctx, a);
  clickReset(ctx, b);
  assert.ok(Math.abs(recText(ctx, a) - before[0]) < 1e-9);
  assert.ok(Math.abs(recText(ctx, b) - before[1]) < 1e-9);
  assert.equal(a.trackedSeconds, 0);
  assert.ok(a.dailyTotalSeconds >= 0 && b.dailyTotalSeconds >= 0, "счётчики не уходят в минус");
  ctx.close();
});

test("ручное обнуление «Факта» (нули + «Применить») тоже сразу пересчитывает рекомендации", () => {
  const { ctx, a, b } = scene();
  enterFact(ctx, a, 40 * MIN);
  enterFact(ctx, b, 10 * MIN);
  enterFact(ctx, a, 0);
  assert.equal(a.trackedSeconds, 0);
  const shown = [recText(ctx, a), recText(ctx, b)];
  const fresh = freshRecommendations(ctx);
  assert.ok(Math.abs(shown[0] - fresh[0][1]) < 1e-6);
  assert.ok(Math.abs(shown[1] - fresh[1][1]) < 1e-6);
  ctx.close();
});