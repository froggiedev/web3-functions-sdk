import { ethers } from "ethers";
import { JsResolverContextData } from "../../types/JsResolverContext";

export interface JsResolverRunnerOptions {
  memory: number;
  timeout: number;
  runtime: "thread" | "docker";
  showLogs: boolean;
  serverPort?: number;
}

export interface JsResolverRunnerPayload {
  script: string;
  context: JsResolverContextData;
  options: JsResolverRunnerOptions;
  provider: ethers.providers.StaticJsonRpcProvider;
}
