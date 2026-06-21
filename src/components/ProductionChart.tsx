"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const GRID = "#243142";
const AXIS = "#8a9bb0";
const AXIS_COLOR = "#d4773a";
const ALLIES_COLOR = "#4f93c4";

const tooltipStyle = {
  background: "#121922",
  border: "1px solid #243142",
  borderRadius: 6,
  fontSize: 12,
};

export interface PowerMeta {
  key: string;
  name: string;
  color: string;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="label mb-3">{title}</div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ProductionChart({
  incomeByRound,
  powers,
  coalitionByRound,
}: {
  incomeByRound: Record<string, number | string>[];
  powers: PowerMeta[];
  coalitionByRound: { round: string; Axis: number; Allies: number }[];
}) {
  const axisProps = { stroke: AXIS, fontSize: 11 } as const;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="IPC Income by Round — per power">
        <LineChart data={incomeByRound} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="round" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {powers.map((p) => (
            <Line
              key={p.key}
              type="monotone"
              dataKey={p.key}
              name={p.name}
              stroke={p.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ChartCard>

      <ChartCard title="Coalition Production by Round">
        <LineChart data={coalitionByRound} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="round" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="Axis" stroke={AXIS_COLOR} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Allies" stroke={ALLIES_COLOR} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>
    </div>
  );
}
