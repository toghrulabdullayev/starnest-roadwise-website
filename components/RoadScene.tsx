"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/*
 * Decorative traffic: roads down both page gutters plus a crossroad on every
 * seam between full-width sections, with traffic lights, zebra crossings,
 * signs, pedestrians and the occasional (rare) fender-bender.
 *
 * One fixed, aria-hidden canvas with no pointer events; the world is laid out
 * in document coordinates and drawn offset by scrollY, so the roads scroll with
 * the page. Only on screens >= 1400px wide (where the gutters are empty);
 * static under prefers-reduced-motion, hidden in forced-colors mode (CSS).
 */

const CONTENT_W = 1152; // max-w-6xl
const ROAD_HALF = 32; // side road: two 32px lanes
const CROSS_HALF = 22; // crossroad: two 22px lanes
const ZEBRA_HALF = 12;
const ACCEL = 80;
const DECEL = 240;
const CRASH_CHANCE_PER_SEC = 1 / 240;
const CRASH_LIFETIME = 9;

const INK = "#111111";
const ASPHALT = "#2a2a2a";
const PAINT = "#f9fafb";
const DASH = "#facc15";
const CAR_COLORS = ["#0077bc", "#009866", "#d97706", "#f9fafb", "#dc2626", "#6d28d9", "#5cbcf0"];
const SHIRTS = ["#0077bc", "#009866", "#dc2626", "#d97706", "#7c3aed", "#f9fafb", "#ec4899", "#facc15"];
const HAIR = ["#111111", "#3b2a1a", "#6b4423", "#d4a017", "#9ca3af"];

type Light = "green" | "yellow" | "red";
type Axis = "v" | "h";

interface Car {
  axis: Axis;
  dir: 1 | -1;
  road: number; // centre of the road (x for v, y for h)
  lane: number; // centre of the lane, perpendicular coordinate
  pos: number; // front bumper, along the axis
  v: number;
  cruise: number;
  len: number;
  wid: number;
  color: string;
  braking: boolean;
  distractedUntil: number;
  crashedAt: number | null;
  spin: number;
}
interface Crossing {
  x: number;
  y: number;
  offset: number;
}
interface Zebra {
  axis: Axis; // axis of the traffic it interrupts
  road: number;
  at: number; // centre along that axis
  signal: { state: Light; since: number } | null;
}
interface Ped {
  zebra: Zebra;
  side: 1 | -1;
  off: number;
  walked: number;
  speed: number;
  walking: boolean;
  shirt: string;
  hair: string;
}
interface Sign {
  kind: "speed" | "crossing" | "noStop" | "city";
  x: number;
  y: number;
  label?: string;
}
interface Crash {
  x: number;
  y: number;
  t0: number;
  triX: number;
  triY: number;
}
interface World {
  vw: number;
  docH: number;
  roads: number[];
  crosses: number[];
  crossings: Crossing[];
  zebras: Zebra[];
  signs: Sign[];
  cars: Car[];
  peds: Ped[];
  crashes: Crash[];
  groups: Car[][];
  spawnAt: Map<string, number>;
  nextPed: number;
  nextCrashRoll: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// v green → v yellow → all red → h green → h yellow → all red
const PHASES: [Light, Light, number][] = [
  ["green", "red", 7],
  ["yellow", "red", 1.6],
  ["red", "red", 1],
  ["red", "green", 5],
  ["red", "yellow", 1.6],
  ["red", "red", 1],
];
const CYCLE = PHASES.reduce((s, p) => s + p[2], 0);

function lightAt(c: Crossing, t: number): { v: Light; h: Light } {
  let m = (t + c.offset) % CYCLE;
  for (const [v, h, d] of PHASES) {
    if (m < d) return { v, h };
    m -= d;
  }
  return { v: "red", h: "red" };
}

/* ---------- layout ---------- */

function roomAt(el: Element, side: "top" | "bottom"): number {
  const px = (e: Element | null, prop: string) => (e ? parseFloat(getComputedStyle(e).getPropertyValue(prop)) || 0 : 0);
  const child = side === "top" ? el.firstElementChild : el.lastElementChild;
  return px(el, `padding-${side}`) + px(el, `border-${side}-width`) + px(child, `padding-${side}`);
}

/** y of every seam between two adjacent full-width blocks with room for a road. */
function findSeams(vw: number): number[] {
  const blocks = [...document.querySelectorAll("main > section"), document.querySelector("body > footer")].filter(
    (e): e is Element => e !== null,
  );
  const seams: number[] = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i].getBoundingClientRect();
    const b = blocks[i + 1].getBoundingClientRect();
    if (Math.abs(a.bottom - b.top) > 1 || a.width < vw - 2 || b.width < vw - 2) continue;
    if (roomAt(blocks[i], "bottom") < CROSS_HALF + 4 || roomAt(blocks[i + 1], "top") < CROSS_HALF + 4) continue;
    seams.push(Math.round(a.bottom + window.scrollY));
  }
  return seams;
}

function laneList(w: World) {
  const out: { key: string; axis: Axis; dir: 1 | -1; road: number; lane: number }[] = [];
  for (const x of w.roads) {
    out.push({ key: `v${x + 16}`, axis: "v", dir: -1, road: x, lane: x + 16 }); // right-hand traffic
    out.push({ key: `v${x - 16}`, axis: "v", dir: 1, road: x, lane: x - 16 });
  }
  for (const y of w.crosses) {
    out.push({ key: `h${y + 11}`, axis: "h", dir: 1, road: y, lane: y + 11 });
    out.push({ key: `h${y - 11}`, axis: "h", dir: -1, road: y, lane: y - 11 });
  }
  return out;
}

function makeCar(axis: Axis, dir: 1 | -1, road: number, lane: number, pos: number): Car {
  const small = axis === "h";
  const cruise = small ? rand(100, 140) : rand(65, 110);
  return {
    axis, dir, road, lane, pos, v: cruise, cruise,
    len: small ? 26 : 30,
    wid: small ? 15 : 18,
    color: pick(CAR_COLORS),
    braking: false,
    distractedUntil: 0,
    crashedAt: null,
    spin: 0,
  };
}

function build(vw: number, docH: number, crosses: number[]): World {
  const gutter = (vw - CONTENT_W) / 2;
  const roads = [Math.round(gutter / 2), Math.round(vw - gutter / 2)];
  const room = gutter / 2 - ROAD_HALF; // free space either side of a side road
  const nearCross = (y: number, pad: number) => crosses.some((c) => Math.abs(y - c) < CROSS_HALF + pad);

  const crossings: Crossing[] = [];
  for (const y of crosses) for (const x of roads) crossings.push({ x, y, offset: rand(0, CYCLE) });

  const zebras: Zebra[] = [];
  const signs: Sign[] = [];
  const signOff = ROAD_HALF + Math.max(10, Math.min(room / 2, 16));

  roads.forEach((x, ri) => {
    let n = 0;
    for (let y = 380 + ri * 140; y < docH - 120; y += 620) {
      if (nearCross(y, ZEBRA_HALF + 60)) continue;
      const signal = n++ % 2 === 0 ? { state: "green" as Light, since: -99 } : null;
      zebras.push({ axis: "v", road: x, at: y, signal });
      if (!signal) {
        signs.push({ kind: "crossing", x: x + signOff, y: y + 36 });
        signs.push({ kind: "crossing", x: x - signOff, y: y - 36 });
      }
    }
    let k = 0;
    for (let y = 200 + ri * 90; y < docH - 80; y += 310) {
      if (nearCross(y, 60) || zebras.some((z) => z.road === x && Math.abs(z.at - y) < 70)) continue;
      const up = k % 2 === 0;
      const kind = k % 3 === 2 ? "noStop" : "speed";
      signs.push({ kind, x: up ? x + signOff : x - signOff, y, label: k % 4 === 0 ? "40" : "60" });
      k++;
    }
    if (room >= 56 && !nearCross(110, 40)) {
      signs.push({ kind: "city", x: ri === 0 ? x - ROAD_HALF - room / 2 : x + ROAD_HALF + room / 2, y: 110, label: "BAKI" });
    }
  });
  for (const y of crosses) {
    zebras.push({ axis: "h", road: y, at: roads[0] + ROAD_HALF + 36, signal: null });
    zebras.push({ axis: "h", road: y, at: roads[1] - ROAD_HALF - 36, signal: null });
  }

  const w: World = {
    vw, docH, roads, crosses, crossings, zebras, signs,
    cars: [], peds: [], crashes: [], groups: [],
    spawnAt: new Map(),
    nextPed: 1,
    nextCrashRoll: 1,
  };
  for (const l of laneList(w)) {
    const end = l.axis === "v" ? docH : vw;
    for (let p = rand(40, 300); p < end - 40; p += rand(l.axis === "v" ? 260 : 380, l.axis === "v" ? 520 : 700)) {
      w.cars.push(makeCar(l.axis, l.dir, l.road, l.lane, l.dir === 1 ? p : end - p));
    }
  }
  return w;
}

/* ---------- simulation ---------- */

const braking = (v: number) => (v * v) / (2 * DECEL);
const rearOf = (c: Car) => c.pos - c.dir * c.len;

function zebraState(w: World, z: Zebra): Light {
  if (z.signal) return z.signal.state;
  return w.peds.some((p) => p.zebra === z && p.walking) ? "red" : "green";
}

function zebraStop(z: Zebra, dir: 1 | -1) {
  return z.at - dir * (ZEBRA_HALF + 3);
}

/** Distance the car may still travel before an obligatory stop. */
function stopLimit(w: World, c: Car, t: number): number {
  let limit = Infinity;
  const consider = (stopAt: number, state: Light) => {
    const d = (stopAt - c.pos) * c.dir;
    if (d < -1 || state === "green") return;
    if (state === "yellow" && d < braking(c.v) + 2) return; // too close: go through
    limit = Math.min(limit, d);
  };
  for (const x of w.crossings) {
    if (c.axis === "v" && x.x === c.road) consider(x.y - c.dir * (CROSS_HALF + 3), lightAt(x, t).v);
    if (c.axis === "h" && x.y === c.road) consider(x.x - c.dir * (ROAD_HALF + 3), lightAt(x, t).h);
  }
  for (const z of w.zebras) {
    if (z.axis === c.axis && z.road === c.road) consider(zebraStop(z, c.dir), zebraState(w, z));
  }
  return limit;
}

function zebraClear(w: World, z: Zebra): boolean {
  for (const c of w.cars) {
    if (c.axis !== z.axis || c.road !== z.road) continue;
    const lo = Math.min(c.pos, rearOf(c));
    const hi = Math.max(c.pos, rearOf(c));
    if (hi > z.at - ZEBRA_HALF - 2 && lo < z.at + ZEBRA_HALF + 2) return false;
    if (!z.signal) {
      const d = (zebraStop(z, c.dir) - c.pos) * c.dir;
      if (d >= -1 && d < braking(c.v) + 10) return false;
    }
  }
  return true;
}

function crash(w: World, back: Car, front: Car, t: number) {
  for (const c of [back, front]) {
    c.crashedAt = t;
    c.v = 0;
    c.spin = rand(-0.35, 0.35);
    c.distractedUntil = 0;
  }
  const x = back.lane;
  const y = back.pos;
  w.crashes.push({ x, y, t0: t, triX: x, triY: rearOf(back) - back.dir * 18 });
}

function triggerCrash(w: World, t: number, viewTop: number, viewBottom: number, force: boolean) {
  const cands: Car[] = [];
  for (const g of w.groups) {
    for (let i = 1; i < g.length; i++) {
      const c = g[i];
      const lead = g[i - 1];
      if (c.axis !== "v" || c.crashedAt !== null || lead.crashedAt !== null || c.distractedUntil > t) continue;
      if (c.pos < viewTop + 40 || c.pos > viewBottom - 40) continue;
      const gap = (rearOf(lead) - c.pos) * c.dir;
      if (force ? gap > 20 && gap < 600 : lead.v < 5 && gap > 80 && gap < 320 && c.v > 40) cands.push(c);
    }
  }
  if (!cands.length) return false;
  const c = pick(cands);
  c.distractedUntil = t + 15; // eyes on the phone
  c.cruise = Math.max(c.cruise, 150);
  return true;
}

function step(w: World, t: number, dt: number, viewTop: number, viewBottom: number) {
  // group by lane, front-most first
  const byLane = new Map<string, Car[]>();
  for (const c of w.cars) {
    const k = `${c.axis}${c.lane}`;
    const g = byLane.get(k);
    if (g) g.push(c);
    else byLane.set(k, [c]);
  }
  w.groups = [...byLane.values()];
  for (const g of w.groups) g.sort((a, b) => (b.pos - a.pos) * a.dir);

  for (const g of w.groups) {
    g.forEach((c, i) => {
      if (c.crashedAt !== null) return;
      let limit = stopLimit(w, c, t);
      const lead = g[i - 1];
      if (lead) {
        const gap = (rearOf(lead) - c.pos) * c.dir;
        if (c.distractedUntil > t) {
          if (gap <= 0.5) return crash(w, c, lead, t);
        } else limit = Math.min(limit, gap - 6);
      }
      const target = Math.min(c.cruise, Math.sqrt(2 * DECEL * Math.max(0, limit - 1)));
      const prev = c.v;
      c.v = target < c.v ? target : Math.min(target, c.v + ACCEL * dt);
      c.braking = c.v < prev - 0.5 || (c.v < 3 && limit < 40);
      c.pos += c.dir * Math.min(c.v * dt, Math.max(0, limit));
    });
  }

  // leave at the far end, tow crashed cars away
  w.cars = w.cars.filter((c) => {
    if (c.crashedAt !== null) return t - c.crashedAt < CRASH_LIFETIME;
    const end = c.axis === "v" ? w.docH : w.vw;
    const rear = rearOf(c);
    return c.dir === 1 ? rear < end + 2 : rear > -2;
  });
  w.crashes = w.crashes.filter((x) => t - x.t0 < CRASH_LIFETIME);

  // new cars at each lane entry
  for (const l of laneList(w)) {
    const due = w.spawnAt.get(l.key);
    if (due === undefined) {
      w.spawnAt.set(l.key, t + rand(1, 6));
      continue;
    }
    if (t < due) continue;
    const end = l.axis === "v" ? w.docH : w.vw;
    const entry = l.dir === 1 ? -2 : end + 2;
    const blocked = w.cars.some((c) => c.lane === l.lane && c.axis === l.axis && Math.abs(rearOf(c) - entry) < 50);
    if (blocked) continue;
    w.cars.push(makeCar(l.axis, l.dir, l.road, l.lane, entry));
    w.spawnAt.set(l.key, t + (l.axis === "v" ? rand(2.5, 7) : rand(4, 12)));
  }

  // push-button signals on zebras
  for (const z of w.zebras) {
    const s = z.signal;
    if (!s) continue;
    const waiting = w.peds.some((p) => p.zebra === z);
    const next: Light | null =
      s.state === "green" && waiting && t - s.since > 4 ? "yellow"
      : s.state === "yellow" && t - s.since > 2 ? "red"
      : s.state === "red" && !waiting && t - s.since > 1.5 ? "green"
      : null;
    if (next) {
      s.state = next;
      s.since = t;
    }
  }

  // pedestrians
  if (t > w.nextPed) {
    w.nextPed = t + rand(1.2, 3.5);
    const visible = w.zebras.filter((z) => {
      const y = z.axis === "v" ? z.at : z.road;
      return y > viewTop + 20 && y < viewBottom - 20 && w.peds.filter((p) => p.zebra === z).length < 2;
    });
    if (visible.length) {
      const z = pick(visible);
      const side = Math.random() < 0.5 ? 1 : -1;
      const n = Math.random() < 0.2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        w.peds.push({
          zebra: z, side, off: rand(-ZEBRA_HALF + 4, ZEBRA_HALF - 4), walked: -i * 9,
          speed: rand(18, 28), walking: false, shirt: pick(SHIRTS), hair: pick(HAIR),
        });
      }
    }
  }
  w.peds = w.peds.filter((p) => {
    const span = 2 * (p.zebra.axis === "v" ? ROAD_HALF : CROSS_HALF) + 20;
    if (!p.walking) {
      const go = p.zebra.signal ? p.zebra.signal.state === "red" : true;
      if (go && zebraClear(w, p.zebra)) p.walking = true;
    } else p.walked += p.speed * dt;
    return p.walked < span;
  });

  // a very rare fender-bender
  if (t > w.nextCrashRoll) {
    w.nextCrashRoll = t + 1;
    if (Math.random() < CRASH_CHANCE_PER_SEC) triggerCrash(w, t, viewTop, viewBottom, false);
  }
}

/* ---------- drawing ---------- */

function spans(from: number, to: number, gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let s = from;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (b <= s || a >= to) continue;
    if (a > s) out.push([s, a]);
    s = Math.max(s, b);
  }
  if (s < to) out.push([s, to]);
  return out;
}

function drawRoads(ctx: CanvasRenderingContext2D, w: World, top: number, bottom: number) {
  const y0 = Math.max(0, top);
  const y1 = Math.min(w.docH, bottom);
  const crossesInView = w.crosses.filter((y) => y > top - 30 && y < bottom + 30);
  const yGaps = w.crosses.map((y): [number, number] => [y - CROSS_HALF, y + CROSS_HALF]);
  const xGaps = w.roads.map((x): [number, number] => [x - ROAD_HALF, x + ROAD_HALF]);

  ctx.fillStyle = INK;
  for (const x of w.roads) ctx.fillRect(x - ROAD_HALF - 5, y0, 2 * ROAD_HALF + 10, y1 - y0);
  for (const y of crossesInView) ctx.fillRect(0, y - CROSS_HALF - 4, w.vw, 2 * CROSS_HALF + 8);
  ctx.fillStyle = ASPHALT;
  for (const x of w.roads) ctx.fillRect(x - ROAD_HALF, y0, 2 * ROAD_HALF, y1 - y0);
  for (const y of crossesInView) ctx.fillRect(0, y - CROSS_HALF, w.vw, 2 * CROSS_HALF);

  // edge lines
  ctx.fillStyle = PAINT;
  for (const x of w.roads) {
    for (const [a, b] of spans(y0, y1, yGaps)) {
      ctx.fillRect(x - ROAD_HALF - 3, a, 3, b - a);
      ctx.fillRect(x + ROAD_HALF, a, 3, b - a);
    }
  }
  for (const y of crossesInView) {
    for (const [a, b] of spans(0, w.vw, xGaps)) {
      ctx.fillRect(a, y - CROSS_HALF - 2, b - a, 2);
      ctx.fillRect(a, y + CROSS_HALF, b - a, 2);
    }
  }

  // dashed centre lines
  ctx.fillStyle = DASH;
  const near = (v: number, gaps: [number, number][]) => gaps.some(([a, b]) => v + 22 > a - 4 && v < b + 4);
  for (const x of w.roads) {
    for (let y = Math.floor(y0 / 44) * 44; y < y1; y += 44) if (!near(y, yGaps)) ctx.fillRect(x - 2, y, 4, 22);
  }
  for (const y of crossesInView) {
    for (let x = 0; x < w.vw; x += 44) if (!near(x, xGaps)) ctx.fillRect(x, y - 1.5, 22, 3);
  }

  // stop lines
  ctx.fillStyle = PAINT;
  for (const c of w.crossings) {
    if (c.y < top - 60 || c.y > bottom + 60) continue;
    ctx.fillRect(c.x, c.y + CROSS_HALF + 2, ROAD_HALF, 3); // up lane
    ctx.fillRect(c.x - ROAD_HALF, c.y - CROSS_HALF - 5, ROAD_HALF, 3); // down lane
    ctx.fillRect(c.x - ROAD_HALF - 5, c.y, 3, CROSS_HALF); // eastbound
    ctx.fillRect(c.x + ROAD_HALF + 2, c.y - CROSS_HALF, 3, CROSS_HALF); // westbound
  }

  // zebras
  for (const z of w.zebras) {
    if (z.axis === "v") {
      if (z.at < top - 30 || z.at > bottom + 30) continue;
      for (let x = z.road - ROAD_HALF + 3; x < z.road + ROAD_HALF - 4; x += 10) ctx.fillRect(x, z.at - ZEBRA_HALF, 6, 2 * ZEBRA_HALF);
    } else {
      if (z.road < top - 30 || z.road > bottom + 30) continue;
      for (let y = z.road - CROSS_HALF + 3; y < z.road + CROSS_HALF - 4; y += 9) ctx.fillRect(z.at - ZEBRA_HALF, y, 2 * ZEBRA_HALF, 5);
    }
  }
}

function drawTrafficLight(ctx: CanvasRenderingContext2D, x: number, y: number, state: Light, horizontal: boolean) {
  const [w, h] = horizontal ? [24, 10] : [10, 24];
  ctx.fillStyle = INK;
  ctx.fillRect(x - w / 2 + 2, y - h / 2 + 2, w, h);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 2.5);
  ctx.fill();
  ctx.strokeStyle = PAINT;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const lamps: [Light, string][] = [
    ["red", "#ef4444"],
    ["yellow", "#facc15"],
    ["green", "#22c55e"],
  ];
  lamps.forEach(([name, color], i) => {
    const d = (i - 1) * 7;
    ctx.beginPath();
    ctx.arc(horizontal ? x + d : x, horizontal ? y : y + d, 2.6, 0, Math.PI * 2);
    const on = name === state;
    ctx.fillStyle = on ? color : "#3f3f46";
    ctx.shadowColor = color;
    ctx.shadowBlur = on ? 8 : 0;
    ctx.fill();
  });
  ctx.shadowBlur = 0;
}

function drawSign(ctx: CanvasRenderingContext2D, s: Sign, font: string) {
  const { x, y } = s;
  ctx.lineWidth = 1.5;
  if (s.kind === "speed" || s.kind === "noStop") {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 1.5, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = s.kind === "speed" ? PAINT : "#0077bc";
    ctx.fill();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (s.kind === "speed") {
      ctx.fillStyle = INK;
      ctx.font = `800 8px ${font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.label ?? "60", x, y + 0.5);
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x - 5, y + 5);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  } else if (s.kind === "crossing") {
    ctx.fillStyle = INK;
    ctx.fillRect(x - 8 + 1.5, y - 8 + 1.5, 16, 16);
    ctx.fillStyle = "#0077bc";
    ctx.fillRect(x - 8, y - 8, 16, 16);
    ctx.strokeStyle = PAINT;
    ctx.strokeRect(x - 8, y - 8, 16, 16);
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y + 5);
    ctx.lineTo(x - 6, y + 5);
    ctx.closePath();
    ctx.fillStyle = PAINT;
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y - 1, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 0.6, y, 1.2, 3.5);
  } else {
    ctx.fillStyle = INK;
    ctx.fillRect(x - 22 + 2, y - 9 + 2, 44, 18);
    ctx.fillStyle = "#009866";
    ctx.fillRect(x - 22, y - 9, 44, 18);
    ctx.strokeStyle = PAINT;
    ctx.strokeRect(x - 20, y - 7, 40, 14);
    ctx.fillStyle = PAINT;
    ctx.font = `800 8px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`↑ ${s.label}`, x, y + 0.5);
  }
}

function drawCar(ctx: CanvasRenderingContext2D, c: Car, t: number) {
  const mid = c.pos - (c.dir * c.len) / 2;
  const [x, y] = c.axis === "v" ? [c.lane, mid] : [mid, c.lane];
  const heading = c.axis === "v" ? (c.dir === -1 ? 0 : Math.PI) : c.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
  const age = c.crashedAt === null ? 0 : t - c.crashedAt;
  const { len: l, wid: w } = c;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, CRASH_LIFETIME - age));
  ctx.translate(x, y);
  ctx.rotate(heading + c.spin);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 2, -l / 2 + 2, w, l, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-w / 2, -l / 2, w, l, 4);
  ctx.fillStyle = c.color;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillRect(-w / 2 + 3, -l / 2 + l * 0.2, w - 6, l * 0.18); // windscreen
  ctx.fillRect(-w / 2 + 3, l / 2 - l * 0.3, w - 6, l * 0.14); // rear window
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(-w / 2 + 2, -l / 2 + 1.5, 3.5, 2);
  ctx.fillRect(w / 2 - 5.5, -l / 2 + 1.5, 3.5, 2);
  if (c.braking || c.crashedAt !== null) {
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(-w / 2 + 2, l / 2 - 3, 3.5, 2);
    ctx.fillRect(w / 2 - 5.5, l / 2 - 3, 3.5, 2);
  }
  if (c.crashedAt !== null && Math.floor(t * 3) % 2 === 0) {
    ctx.fillStyle = "#f59e0b"; // hazards
    for (const [hx, hy] of [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]]) {
      ctx.beginPath();
      ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function pedPos(p: Ped): [number, number, number] {
  const z = p.zebra;
  const half = (z.axis === "v" ? ROAD_HALF : CROSS_HALF) + 10;
  const across = z.road + p.side * half - p.side * Math.max(0, p.walked);
  const along = z.at + p.off;
  // heading: walking perpendicular to the road's traffic
  return z.axis === "v" ? [across, along, p.side === 1 ? -Math.PI / 2 : Math.PI / 2] : [along, across, p.side === 1 ? 0 : Math.PI];
}

function drawPed(ctx: CanvasRenderingContext2D, p: Ped) {
  if (p.walked < 0) return;
  const [x, y, a] = pedPos(p);
  const swing = p.walking ? Math.sin(p.walked * 0.45) * 3 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = INK;
  for (const [lx, ly] of [[-2, swing], [2, -swing]]) {
    ctx.beginPath();
    ctx.ellipse(lx, ly, 1.6, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = p.shirt;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = p.hair;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCrash(ctx: CanvasRenderingContext2D, k: Crash, t: number) {
  const age = t - k.t0;
  if (age < 0.7) {
    const r = 6 + (age / 0.7) * 14;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const rr = i % 2 === 0 ? r : r * 0.5;
      const a = (i / 16) * Math.PI * 2;
      ctx.lineTo(k.x + Math.cos(a) * rr, k.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = "#facc15";
    ctx.fill();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const fade = Math.max(0, Math.min(1, CRASH_LIFETIME - age));
  for (let i = 0; i < 3; i++) {
    const ph = (age * 0.6 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc(k.x + Math.sin(age * 2 + i) * 4, k.y - ph * 18, 3 + ph * 7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(156,163,175,${(1 - ph) * 0.55 * fade})`;
    ctx.fill();
  }
  if (age > 1.2) {
    // warning triangle placed behind the cars
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.moveTo(k.triX, k.triY - 6);
    ctx.lineTo(k.triX + 6, k.triY + 5);
    ctx.lineTo(k.triX - 6, k.triY + 5);
    ctx.closePath();
    ctx.fillStyle = PAINT;
    ctx.fill();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function draw(ctx: CanvasRenderingContext2D, w: World, t: number, scrollY: number, viewH: number, font: string) {
  const top = scrollY;
  const bottom = scrollY + viewH;
  const inView = (y: number) => y > top - 60 && y < bottom + 60;
  ctx.save();
  ctx.translate(0, -scrollY);
  drawRoads(ctx, w, top, bottom);

  for (const c of w.cars) if (inView(c.axis === "v" ? c.pos : c.lane)) drawCar(ctx, c, t);
  for (const p of w.peds) if (inView(p.zebra.axis === "v" ? p.zebra.at : p.zebra.road)) drawPed(ctx, p);
  for (const k of w.crashes) if (inView(k.y)) drawCrash(ctx, k, t);

  for (const c of w.crossings) {
    if (!inView(c.y)) continue;
    const s = lightAt(c, t);
    drawTrafficLight(ctx, c.x + ROAD_HALF + 9, c.y + CROSS_HALF + 16, s.v, false);
    drawTrafficLight(ctx, c.x - ROAD_HALF - 9, c.y - CROSS_HALF - 16, s.v, false);
    drawTrafficLight(ctx, c.x - ROAD_HALF - 14, c.y + CROSS_HALF + 9, s.h, true);
    drawTrafficLight(ctx, c.x + ROAD_HALF + 14, c.y - CROSS_HALF - 9, s.h, true);
  }
  for (const z of w.zebras) {
    if (!z.signal || !inView(z.at)) continue;
    drawTrafficLight(ctx, z.road + ROAD_HALF + 9, z.at + ZEBRA_HALF + 16, z.signal.state, false);
    drawTrafficLight(ctx, z.road - ROAD_HALF - 9, z.at - ZEBRA_HALF - 16, z.signal.state, false);
  }
  for (const s of w.signs) if (inView(s.y)) drawSign(ctx, s, font);
  ctx.restore();
}

/* ---------- component ---------- */

export function RoadScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const relayoutRef = useRef<() => void>(() => {});
  const pathname = usePathname();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const wide = window.matchMedia("(min-width: 1400px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const font = getComputedStyle(document.body).fontFamily;
    let world: World | null = null;
    let signature = "";
    let t = 0;
    let last = 0;
    let raf = 0;
    let timer = 0;

    const render = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!world) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, world, t, window.scrollY, canvas.clientHeight, font);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      if (world) {
        t += dt;
        step(world, t, dt, window.scrollY, window.scrollY + canvas.clientHeight);
      }
      render();
      raf = requestAnimationFrame(frame);
    };

    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!wide.matches) {
        world = null;
        signature = "";
        render();
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      const vw = canvas.clientWidth;
      const docH = document.documentElement.scrollHeight;
      const seams = findSeams(vw);
      const sig = `${vw}|${docH}|${seams.join(",")}`;
      if (sig !== signature) {
        signature = sig;
        world = build(vw, docH, seams);
      }
      render();
      if (!reduced.matches) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const relayoutSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(relayout, 150);
    };
    relayoutRef.current = relayoutSoon;

    const onScroll = () => {
      if (reduced.matches) render(); // otherwise the animation loop redraws
    };
    const ro = new ResizeObserver(relayoutSoon);
    ro.observe(document.body);
    window.addEventListener("resize", relayoutSoon);
    window.addEventListener("scroll", onScroll, { passive: true });
    wide.addEventListener("change", relayout);
    reduced.addEventListener("change", relayout);

    if (process.env.NODE_ENV !== "production") {
      // dev helpers: __roads.crash() forces a crash in view
      (window as unknown as { __roads: unknown }).__roads = {
        crash: () =>
          world ? triggerCrash(world, t, window.scrollY, window.scrollY + canvas.clientHeight, true) : false,
      };
    }

    relayout();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener("resize", relayoutSoon);
      window.removeEventListener("scroll", onScroll);
      wide.removeEventListener("change", relayout);
      reduced.removeEventListener("change", relayout);
    };
  }, []);

  useEffect(() => {
    relayoutRef.current();
  }, [pathname]);

  return <canvas ref={canvasRef} aria-hidden="true" className="road-scene" />;
}
