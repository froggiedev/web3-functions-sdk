import { BigNumber } from "ethers";
import { JsResolverUserArgs } from "./JsResolverUserArgs";
export interface JsResolverContextData {
  gelatoArgs: {
    blockTime: number;
    chainId: number;
    gasPrice: string;
    taskId?: string;
  };
  userArgs: JsResolverUserArgs;
  secrets: { [key: string]: string | undefined };
  storage: { [key: string]: string | undefined };
}

export interface JsResolverContext {
  gelatoArgs: {
    blockTime: number;
    chainId: number;
    gasPrice: BigNumber;
    taskId?: string;
  };
  userArgs: JsResolverUserArgs;
  secrets: {
    get(key: string): Promise<string | undefined>;
  };
  storage: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
}
