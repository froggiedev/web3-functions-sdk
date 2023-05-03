import { MultiChainProviderConfig } from "../../provider";
import { Web3FunctionContextData } from "../../types/Web3FunctionContext";
import { Web3FunctionVersion } from "../../types";

export interface Web3FunctionRunnerOptions {
  memory: number;
  timeout: number;
  rpcLimit: number;
  runtime: "thread" | "docker";
  showLogs: boolean;
  serverPort?: number;
}

export interface Web3FunctionRunnerPayload {
  script: string;
  context: Web3FunctionContextData;
  options: Web3FunctionRunnerOptions;
  multiChainProviderConfig: MultiChainProviderConfig;
  version: Web3FunctionVersion;
}
