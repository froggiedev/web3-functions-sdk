import { performance } from "perf_hooks";
import { JsResolverTcpHelper } from "../tcp/JsResolverTcpHelper";
import { JsResolverTcpClient } from "../tcp/JsResolverTcpClient";
import { JsResolverContextData } from "../types/JsResolverContext";
import { JsResolverEvent } from "../types/JsResolverEvent";
import { JsResolverAbstractSandbox } from "./sandbox/JsResolverAbstractSandbox";
import { JsResolverDockerSandbox } from "./sandbox/JsResolverDockerSandbox";
import { JsResolverThreadSandbox } from "./sandbox/JsResolverThreadSandbox";
import {
  JsResolverExec,
  JsResolverRunnerPayload,
  JsResolverRunnerOptions,
} from "./types";
import { JsResolverUserArgs } from "../types/JsResolverUserArgs";

const START_TIMEOUT = 10_000;

export class JsResolverRunner {
  private _debug: boolean;
  private _memory = 0;
  private _client?: JsResolverTcpClient;
  private _sandbox?: JsResolverAbstractSandbox;
  private _execTimeoutId?: NodeJS.Timeout;
  private _memoryIntervalId?: NodeJS.Timer;

  constructor(debug = false) {
    this._debug = debug;
  }

  public async validateUserArgs(
    schema: {
      [key: string]: string;
    },
    inputUserArgs: { [key: string]: string }
  ): Promise<JsResolverUserArgs> {
    const typedUserArgs: JsResolverUserArgs = {};
    for (const key in schema) {
      const value = inputUserArgs[key];
      if (typeof value === "undefined") {
        throw new Error(`JsResolverSchemaError: Missing user arg '${key}'`);
      }
      const type = schema[key];
      switch (type) {
        case "boolean":
          typedUserArgs[key] = !(value === "false" || value === "0");
          break;
        case "boolean[]": {
          try {
            const a = JSON.parse(value);
            typedUserArgs[key] = a.map((v) => !(v === false || v === 0));
          } catch (err) {
            throw new Error(
              `Parsing ${value} to boolean[] failed. \n${err.message}`
            );
          }
          break;
        }
        case "string":
          typedUserArgs[key] = value;
          break;
        case "string[]": {
          try {
            typedUserArgs[key] = JSON.parse(value);
          } catch (err) {
            throw new Error(
              `Parsing ${value} to string[] failed. \n${err.message}`
            );
          }
          break;
        }
        case "number": {
          const parsedValue = value.includes(".")
            ? parseFloat(value)
            : parseInt(value);
          if (isNaN(parsedValue)) {
            throw new Error(
              `JsResolverSchemaError: Invalid number value '${value}' for user arg '${key}'`
            );
          }
          typedUserArgs[key] = parsedValue;
          break;
        }
        case "number[]":
          try {
            typedUserArgs[key] = JSON.parse(value);
          } catch (err) {
            throw new Error(
              `Parsing ${value} to number[] failed. \n${err.message}`
            );
          }
          break;
        default:
          throw new Error(
            `JsResolverSchemaError: Unrecognized type '${type}' for user arg '${key}'`
          );
      }
    }
    return typedUserArgs;
  }

  public async run(payload: JsResolverRunnerPayload): Promise<JsResolverExec> {
    const start = performance.now();
    let success;
    let result;
    let error;
    try {
      const { script, context, options } = payload;
      result = await this._runInSandbox(script, context, options);
      success = true;
    } catch (err) {
      error = err;
      success = false;
    } finally {
      await this.stop();
    }

    const logs = [];
    const duration = (performance.now() - start) / 1000;
    const memory = this._memory / 1024 / 1024;
    this._log(`Runtime duration=${duration.toFixed(2)}s`);
    this._log(`Runtime memory=${memory.toFixed(2)}mb`);
    if (success) {
      return { success, result, logs, duration, memory };
    } else {
      return { success, error, logs, duration, memory };
    }
  }

  private async _runInSandbox(
    script: string,
    context: JsResolverContextData,
    options: JsResolverRunnerOptions
  ) {
    const SandBoxClass =
      options.runtime === "thread"
        ? JsResolverThreadSandbox
        : JsResolverDockerSandbox;
    this._sandbox = new SandBoxClass(
      { memoryLimit: options.memory },
      options.showLogs ?? false,
      this._debug
    );

    const serverPort =
      options.serverPort ?? (await JsResolverTcpHelper.getAvailablePort());
    try {
      this._log(`Sarting sandbox: ${script}`);
      await this._sandbox.start(script, serverPort);
    } catch (err) {
      this._log(`Fail to start JsResolver in sandbox ${err.message}`);
      throw new Error(`JsResolver failed to start sandbox: ${err.message}`);
    }

    // Attach process exit handler to clean runtime environment
    process.on("SIGINT", this.stop.bind(this));

    // Start monitoring memory usage
    this._monitorMemoryUsage();

    this._client = new JsResolverTcpClient(serverPort, this._debug);
    try {
      await this._client.connect(START_TIMEOUT);
    } catch (err) {
      this._log(`Fail to connect to JsResolver ${err.message}`);
      throw new Error(
        `JsResolver start-up timeout (${
          START_TIMEOUT / 1000
        }s) \nMake sure you registered your checker function correctly in your script.`
      );
    }

    return new Promise((resolve, reject) => {
      let isResolved = false;
      this._client?.emit("input_event", { action: "start", data: { context } });
      this._client?.on("output_event", (event: JsResolverEvent) => {
        this._log(`Received event: ${event.action}`);
        switch (event.action) {
          case "result":
            isResolved = true;
            resolve(event.data.result);
            break;
          case "error":
            isResolved = true;
            reject(event.data.error);
            break;
          default:
            this._log(`Unknown event: ${event.action}`);
        }
      });

      // Stop waiting for result after timeout expire
      this._execTimeoutId = setTimeout(() => {
        reject(
          new Error(
            `JsResolver exceed execution timeout (${options.timeout / 1000}s)`
          )
        );
      }, options.timeout);

      // Listen to sandbox exit status code to detect runtime error
      this._sandbox?.waitForProcessEnd().then((signal: number) => {
        if (!isResolved)
          if (signal === 0) {
            reject(new Error(`JsResolver exited without returning result`));
          } else {
            reject(new Error(`JsResolver sandbox exited with code=${signal}`));
          }
      });
    });
  }

  private _monitorMemoryUsage() {
    this._memoryIntervalId = setInterval(async () => {
      try {
        const liveMemory = await this._sandbox?.getMemoryUsage();
        if (liveMemory && liveMemory > this._memory) this._memory = liveMemory;
      } catch (err) {
        // Ignore
      }
    }, 100);
  }

  public async stop() {
    this._log("Stopping runtime environment...");
    if (this._sandbox) await this._sandbox.stop();
    if (this._client) this._client.end();
    if (this._execTimeoutId) clearTimeout(this._execTimeoutId);
    if (this._memoryIntervalId) clearInterval(this._memoryIntervalId);
    // Remove process exit handler
    process.off("SIGINT", this.stop.bind(this));
  }

  private _log(message: string) {
    if (this._debug) console.log(`JsResolverRunner: ${message}`);
  }
}
