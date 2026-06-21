// @3d-dice/dice-box ships no type declarations; declare it loosely so the
// strict production type-check passes. The runtime API we use is documented
// in src/components/BattleStage.tsx.
declare module "@3d-dice/dice-box" {
  const DiceBox: new (config: Record<string, unknown>) => {
    init(): Promise<unknown>;
    roll(notation: unknown): Promise<Array<{ value: number; [k: string]: unknown }>>;
    add(notation: unknown): Promise<unknown>;
    clear(): void;
    updateConfig(config: Record<string, unknown>): void;
    onRollComplete?: (results: Array<{ value: number }>) => void;
    [k: string]: unknown;
  };
  export default DiceBox;
}
