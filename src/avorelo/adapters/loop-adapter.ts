// Avorelo LoopAdapter interface (V1). Separate from AgentAdapter — not all agents support loops.
// LoopAdapter.executeIteration runs one bounded iteration and returns structured output.

export type IterationInput = {
  task: string;
  cwd: string;
  iteration: number;
  maxIterations: number;
  allowedPaths: string[];
  disallowedPaths: string[];
  allowedCommands: string[];
  blockedCommands: string[];
  previousFailures: string[];
  previousDrift: string[];
};

export type IterationOutput = {
  exitCode: number;
  filesChanged: string[];
  commandsRun: string[];
  durationMs: number;
  agentError: string | null;
  truncatedLog: string | null;
};

export type LoopAdapter = {
  id: string;
  displayName: string;
  executeIteration(input: IterationInput): Promise<IterationOutput>;
  isAvailable(): boolean;
};
