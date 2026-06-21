"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ReferenceLine,
} from "recharts";

const GRID = "#243142";
const AXIS = "#8a9bb0";
const GOOD = "#3fb27f";
const BAD = "#d65a5a";

export interface RoundPoint {
  round: string;
  incomeAdv: number;
  netAdv: number;
  cumNetAdv: number;
  friendlyAP: number;
  enemyAP: number;
}
export interface NationBar {
  name: string;
  value: number;
  color: string;
}

const tooltipStyle = {
  background: "#121922",
  border: "1px solid #243142",
  borderRadius: 6,
  fontSize: 12,
};

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="label mb-3">{title}</div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  );
}

export default function CampaignCharts({
  rounds,
  lossByNation,
  apByNation,
  playerLabel,
}: {
  rounds: RoundPoint[];
  lossByNation: NationBar[];
  apByNation: NationBar[];
  playerLabel: string;
}) {
  const axisProps = { stroke: AXIS, fontSize: 11 } as const;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Net Economic Advantage by Round">
        <LineChart data={rounds} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="round" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <ReferenceLine y={0} stroke={AXIS} />
          <Line type="monotone" dataKey="netAdv" name="Net Adv (round)" stroke={GOOD} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cumNetAdv" name="Cumulative" stroke="#d4a017" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Attack Power by Round">
        <LineChart data={rounds} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="round" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="friendlyAP" name={playerLabel} stroke={GOOD} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="enemyAP" name="Enemy" stroke={BAD} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Attack Power by Nation (current round)">
        <BarChart data={apByNation} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" {...axisProps} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
          <Bar dataKey="value" name="Attack Power" radius={[3, 3, 0, 0]}>
            {apByNation.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      <ChartCard title="Total IPC Losses by Nation">
        <BarChart data={lossByNation} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" {...axisProps} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
          <Bar dataKey="value" name="IPC Lost" radius={[3, 3, 0, 0]}>
            {lossByNation.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>
    </div>
  );
}
