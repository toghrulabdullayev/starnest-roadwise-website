"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

export interface ProgressPoint {
  n: number;
  label: string;
  compliance: number | null;
  composure: number;
  fines: number;
}

type MetricKey = "compliance" | "composure" | "fines";

const PRIMARY = "#0077bc";
const GRID = "#e5e7eb";
const MUTED = "#4b5563";

function ChartTooltip({ active, payload, unit, driveLabel }: TooltipContentProps<number, string> & { unit: string; driveLabel: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as ProgressPoint;
  const v = payload[0].value;
  return (
    <div className="border-2 border-surface bg-canvas px-3 py-2 shadow-bold-sm">
      <p className="font-display text-lg leading-tight">
        {v === null || v === undefined ? "—" : `${v}${unit}`}
      </p>
      <p className="text-xs text-text-muted">
        {driveLabel(p.n)} · {p.label}
      </p>
    </div>
  );
}

function SmallMultiple({
  data,
  dataKey,
  title,
  unit,
  domain,
  driveLabel,
}: {
  data: ProgressPoint[];
  dataKey: MetricKey;
  title: string;
  unit: string;
  domain: [number, number | "auto"];
  driveLabel: (n: number) => string;
}) {
  const last = [...data].reverse().find((d) => d[dataKey] !== null);
  return (
    <figure className="flex min-w-0 flex-col gap-2 border-2 border-surface bg-canvas p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{title}</span>
        {last && (
          <span className="font-mono text-sm tabular-nums text-text">
            {last[dataKey]}
            {unit}
          </span>
        )}
      </figcaption>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
            <XAxis dataKey="n" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: MUTED, fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis domain={domain} tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 12 }} width={44} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: "#111827", strokeWidth: 1 }}
              content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} unit={unit} driveLabel={driveLabel} />}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey={dataKey}
              stroke={PRIMARY}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: PRIMARY, stroke: "#ffffff", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: PRIMARY, stroke: "#ffffff", strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function ProgressCharts({
  data,
  labels,
}: {
  data: ProgressPoint[];
  labels: { compliance: string; composure: string; fines: string; drive: string; needTwo: string };
}) {
  const driveLabel = (n: number) => labels.drive.replace("{n}", String(n));
  return (
    <div className="flex flex-col gap-3">
      {data.length < 2 && <p className="text-text-muted">{labels.needTwo}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <SmallMultiple data={data} dataKey="compliance" title={labels.compliance} unit="%" domain={[0, 100]} driveLabel={driveLabel} />
        <SmallMultiple data={data} dataKey="composure" title={labels.composure} unit="" domain={[0, 100]} driveLabel={driveLabel} />
        <SmallMultiple data={data} dataKey="fines" title={labels.fines} unit="" domain={[0, "auto"]} driveLabel={driveLabel} />
      </div>
    </div>
  );
}
