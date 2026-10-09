"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Trace, TraceMarker } from "@/lib/trace";
import type { Debrief } from "@/lib/prompts/debrief";
import type { DebriefStatus } from "@/lib/drives/queries";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import type { RuleKey } from "@/lib/rules/catalog";

export interface TimelineItem {
  id: string;
  time: string;
  kind: "major" | "minor" | "pass" | "checkpoint";
  title: string;
  street?: string;
  note?: string;
}

export interface DebriefView {
  status: DebriefStatus;
  locale: Locale;
  content: Debrief | null;
  model: string | null;
}

type Labels = Dictionary["drive"];

const C = { route: "#0077bc", over: "#dc2626", major: "#dc2626", minor: "#d97706", pass: "#16a34a", ink: "#111111", ring: "#ffffff" };

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// ---------- map ----------
function MarkerShape({ m, r, selected }: { m: TraceMarker; r: number; selected: boolean }) {
  const rr = selected ? r * 1.5 : m.kind === "pass" ? r * 0.7 : r;
  const ring = r * 0.35;
  if (m.kind === "major") {
    const d = rr * 1.9;
    return (
      <rect
        x={m.x - d / 2}
        y={m.z - d / 2}
        width={d}
        height={d}
        transform={`rotate(45 ${m.x} ${m.z})`}
        fill={C.major}
        stroke={selected ? C.ink : C.ring}
        strokeWidth={ring}
      />
    );
  }
  if (m.kind === "minor") return <circle cx={m.x} cy={m.z} r={rr} fill={C.minor} stroke={selected ? C.ink : C.ring} strokeWidth={ring} />;
  return <circle cx={m.x} cy={m.z} r={rr} fill={C.ring} stroke={selected ? C.ink : C.pass} strokeWidth={ring} />;
}

function TraceMap({
  trace,
  selected,
  onSelect,
  labels,
  markerLabel,
}: {
  trace: Trace;
  selected: string | null;
  onSelect: (id: string) => void;
  labels: Labels;
  markerLabel: (m: TraceMarker) => string;
}) {
  const [x, z, w, h] = trace.viewBox;
  const unit = Math.max(w, h) / 100;
  const r = unit * 1.6;
  // draw faults above passes, the selected marker on top
  const order = [...trace.markers].sort(
    (a, b) => Number(a.id === selected) - Number(b.id === selected) || (a.kind === "pass" ? -1 : 0) - (b.kind === "pass" ? -1 : 0),
  );
  return (
    <figure className="flex flex-col gap-3">
      <div className="border-2 border-surface bg-[#f8fafc]">
        <svg viewBox={`${x} ${z} ${w} ${h}`} role="group" aria-label={labels.mapLabel} className="block h-auto max-h-[28rem] w-full">
          {trace.runs.map((run, i) => (
            <polyline
              key={i}
              points={run.points.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke={run.over ? C.over : C.route}
              strokeWidth={run.over ? 5 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {trace.start && (
            <rect x={trace.start[0] - r} y={trace.start[1] - r} width={r * 2} height={r * 2} fill={C.ink} stroke={C.ring} strokeWidth={r * 0.35}>
              <title>{labels.legend.start}</title>
            </rect>
          )}
          {order.map((m) => {
            const active = m.id === selected;
            return (
              <g
                key={m.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={markerLabel(m)}
                data-marker={m.id}
                onClick={() => onSelect(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(m.id);
                  }
                }}
                className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-primary"
              >
                {/* hit target larger than the mark */}
                <circle cx={m.x} cy={m.z} r={r * 3} fill="transparent" stroke="none" strokeWidth={unit * 0.6} />
                <MarkerShape m={m} r={r} selected={active} />
                <title>{markerLabel(m)}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-[3px] w-6 bg-primary" />
            {labels.legend.route}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-[5px] w-6 bg-danger" />
            {labels.legend.overspeed}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-3 rotate-45 bg-danger" />
            {labels.legend.major}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-3 rounded-full bg-warning" />
            {labels.legend.minor}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-3 rounded-full border-2 border-success bg-canvas" />
            {labels.legend.pass}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-3 bg-surface" />
            {labels.legend.start}
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}

// ---------- timeline ----------
const kindStyle: Record<TimelineItem["kind"], string> = {
  major: "border-l-danger",
  minor: "border-l-warning",
  pass: "border-l-success",
  checkpoint: "border-l-line-soft",
};

function EventTimeline({
  items,
  selected,
  onSelect,
  labels,
}: {
  items: TimelineItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  labels: Labels;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-event="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  if (items.length === 0) return <p className="text-text-muted">{labels.timelineEmpty}</p>;
  return (
    <ol ref={listRef} className="flex max-h-[34rem] flex-col gap-2 overflow-y-auto pr-1">
      {items.map((it) => {
        const active = it.id === selected;
        const clickable = it.kind !== "checkpoint";
        const body = (
          <>
            <span className="font-mono text-sm font-bold tabular-nums">{it.time}</span>
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">{it.title}</span>
              {(it.street || it.note) && <span className="text-sm text-text-muted">{[it.street, it.note].filter(Boolean).join(" · ")}</span>}
            </span>
            <span className="justify-self-end">
              {it.kind === "major" && <span className="font-mono text-xs font-bold uppercase text-danger-ink">◆ {labels.major}</span>}
              {it.kind === "minor" && <span className="font-mono text-xs font-bold uppercase text-warning-ink">● {labels.minor}</span>}
              {it.kind === "pass" && <span className="font-mono text-xs font-bold uppercase text-success-ink">✓ {labels.pass}</span>}
            </span>
          </>
        );
        const cls = `grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 border-2 border-l-8 px-3 py-2 text-left ${kindStyle[it.kind]} ${
          active ? "border-surface bg-[#eff8ff] shadow-bold-sm" : "border-line-soft bg-canvas"
        }`;
        return (
          <li key={it.id} data-event={it.id}>
            {clickable ? (
              <button type="button" aria-pressed={active} onClick={() => onSelect(it.id)} className={`${cls} min-h-11 cursor-pointer hover:border-surface`}>
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- debrief ----------
function DebriefCard({
  driveId,
  debrief,
  currentLocale,
  localeNames,
  labels,
  ruleNames,
  eventTimes,
  onShowEvent,
}: {
  driveId: string;
  debrief: DebriefView | null;
  currentLocale: Locale;
  localeNames: Record<Locale, string>;
  labels: Labels;
  ruleNames: Record<RuleKey, string>;
  eventTimes: Record<string, string>;
  onShowEvent: (id: string) => void;
}) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const pending = !debrief || debrief.status === "pending";

  // Poll every 3 s while the debrief is being written.
  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/drives/${driveId}?locale=${currentLocale}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const body = (await res.json()) as { debrief: { status: DebriefStatus } | null };
        if (body.debrief && body.debrief.status !== "pending") {
          stop = true;
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [pending, driveId, currentLocale, router]);

  async function regenerate() {
    setRegenerating(true);
    try {
      await fetch(`/api/drives/${driveId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: currentLocale }),
      });
    } finally {
      router.refresh();
    }
  }

  if (pending) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-4 border-2 border-surface bg-canvas p-6">
        <span aria-hidden="true" className="inline-block size-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <div>
          <p className="font-bold">{labels.pending}</p>
          <p className="text-sm text-text-muted">{labels.pendingNote}</p>
        </div>
      </div>
    );
  }

  const d = debrief!.content!;
  const otherLanguage = debrief!.locale !== currentLocale;
  const sectionTitle = "font-sans text-sm font-bold uppercase tracking-wide text-text-muted";

  return (
    <article className="flex flex-col gap-6 border-2 border-surface bg-canvas p-4 shadow-bold sm:p-6">
      {otherLanguage && (
        <div lang={currentLocale} className="flex flex-wrap items-center justify-between gap-3 border-2 border-primary bg-[#eff8ff] px-4 py-3">
          <p className="font-semibold text-primary-ink">{fill(labels.otherLanguage, { language: localeNames[debrief!.locale] })}</p>
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating}
            className="inline-flex min-h-11 items-center border-2 border-surface bg-primary px-4 font-bold uppercase text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {regenerating ? labels.regenerating : fill(labels.regenerate, { language: localeNames[currentLocale] })}
          </button>
        </div>
      )}

      <section>
        <h3 className={sectionTitle}>{labels.summary}</h3>
        <p lang={debrief!.locale} className="mt-1 text-lg">{d.summary}</p>
      </section>

      <section>
        <h3 className={sectionTitle}>{labels.issues}</h3>
        {d.issues.length === 0 ? (
          <p className="mt-1">{labels.noIssues}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-3">
            {d.issues.map((issue, i) => (
              <li key={i} className={`border-2 border-l-8 border-surface p-4 ${issue.severity === "major" ? "border-l-danger" : "border-l-warning"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-mono text-xs font-bold uppercase ${issue.severity === "major" ? "text-danger-ink" : "text-warning-ink"}`}
                  >
                    {issue.severity === "major" ? `◆ ${labels.major}` : `● ${labels.minor}`}
                  </span>
                  <span className="font-mono text-xs text-text-muted">{ruleNames[issue.rule]}</span>
                </div>
                <h4 lang={debrief!.locale} className="mt-1 font-display text-xl">{issue.title}</h4>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-bold">{labels.whyItMatters}</dt>
                    <dd lang={debrief!.locale}>{issue.why_it_matters}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-bold">{labels.howToFix}</dt>
                    <dd lang={debrief!.locale}>{issue.how_to_fix}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {issue.event_ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onShowEvent(id)}
                      className="inline-flex min-h-11 items-center border-2 border-surface px-3 font-mono text-sm font-bold hover:bg-canvas-2"
                    >
                      {fill(labels.seeEvent, { time: eventTimes[id] ?? id })}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {d.strengths.length > 0 && (
        <section>
          <h3 className={sectionTitle}>{labels.strengths}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {d.strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true" className="font-bold text-success-ink">
                  ✓
                </span>
                <span lang={debrief!.locale}>{s.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.progress && (d.progress.improved.length > 0 || d.progress.worse.length > 0) && (
        <section>
          <h3 className={sectionTitle}>{labels.progress}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {d.progress.improved.map((s, i) => (
              <li key={`i${i}`} className="flex gap-2">
                <span className="font-mono font-bold text-success-ink">▲</span>
                <span>
                  <span className="sr-only">{labels.improved}: </span>
                  <span lang={debrief!.locale}>{s}</span>
                </span>
              </li>
            ))}
            {d.progress.worse.map((s, i) => (
              <li key={`w${i}`} className="flex gap-2">
                <span className="font-mono font-bold text-danger-ink">▼</span>
                <span>
                  <span className="sr-only">{labels.worse}: </span>
                  <span lang={debrief!.locale}>{s}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="on-dark bg-surface p-4 text-text-on-dark">
          <h3 className="font-sans text-sm font-bold uppercase tracking-wide text-primary-on-dark">
            {labels.nextDrive} · {labels.nextMode[d.next_drive.mode]}
          </h3>
          <p lang={debrief!.locale} className="mt-1 font-display text-xl">{d.next_drive.focus}</p>
          <p className="mt-3 text-sm font-bold text-text-on-dark-muted">{labels.drills}</p>
          <ul className="mt-1 list-disc pl-5">
            {d.next_drive.drills.map((s, i) => (
              <li key={i} lang={debrief!.locale}>{s}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={sectionTitle}>{labels.readiness}</h3>
          <p lang={debrief!.locale} className="mt-1">{d.readiness_comment}</p>
        </section>
      </div>

      <p lang={currentLocale} className="border-t-2 border-line-soft pt-3 text-sm text-text-muted">
        {debrief!.status === "ready" ? fill(labels.sourceAi, { model: debrief!.model ?? "AI" }) : labels.sourceFallback}
      </p>
    </article>
  );
}

// ---------- explorer ----------
export function DriveExplorer({
  driveId,
  currentLocale,
  localeNames,
  trace,
  timeline,
  debrief,
  labels,
  ruleNames,
}: {
  driveId: string;
  currentLocale: Locale;
  localeNames: Record<Locale, string>;
  trace: Trace;
  timeline: TimelineItem[];
  debrief: DebriefView | null;
  labels: Labels;
  ruleNames: Record<RuleKey, string>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const byId = Object.fromEntries(timeline.map((t) => [t.id, t]));
  const eventTimes = Object.fromEntries(timeline.map((t) => [t.id, t.time]));
  const markerLabel = useCallback(
    (m: TraceMarker) => {
      const it = byId[m.id];
      const kind = m.kind === "pass" ? labels.pass : m.kind === "major" ? labels.major : labels.minor;
      return `${it?.time ?? ""} · ${it?.title ?? ruleNames[m.rule]} · ${kind}`;
    },
    [byId, labels, ruleNames],
  );
  const showEvent = (id: string) => {
    setSelected(id);
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="debrief-title" className="flex flex-col gap-4">
        <h2 id="debrief-title" className="text-2xl uppercase sm:text-3xl">
          {labels.debriefTitle}
        </h2>
        <DebriefCard
          driveId={driveId}
          debrief={debrief}
          currentLocale={currentLocale}
          localeNames={localeNames}
          labels={labels}
          ruleNames={ruleNames}
          eventTimes={eventTimes}
          onShowEvent={showEvent}
        />
      </section>

      <div ref={mapRef} className="grid scroll-mt-4 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="map-title" className="flex min-w-0 flex-col gap-3">
          <div>
            <h2 id="map-title" className="text-2xl uppercase sm:text-3xl">
              {labels.mapTitle}
            </h2>
            <p className="text-text-muted">{labels.mapLead}</p>
          </div>
          <TraceMap trace={trace} selected={selected} onSelect={setSelected} labels={labels} markerLabel={markerLabel} />
        </section>
        <section aria-labelledby="timeline-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="timeline-title" className="text-2xl uppercase sm:text-3xl">
            {labels.timelineTitle}
          </h2>
          <EventTimeline items={timeline} selected={selected} onSelect={setSelected} labels={labels} />
        </section>
      </div>
    </div>
  );
}
