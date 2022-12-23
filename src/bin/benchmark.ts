#! /usr/bin/env node
import "dotenv/config";
import colors from "colors/safe";
import { setTimeout as delay } from "timers/promises";
import { performance } from "perf_hooks";
import { ethers } from "ethers";

import { JsResolverContextData } from "../lib/types";
import {
  JsResolverExec,
  JsResolverRunnerPool,
  JsResolverRunner,
} from "../lib/runtime";
import { JsResolverBuilder } from "../lib/builder";

if (!process.env.PROVIDER_URL) {
  console.error(`Missing PROVIDER_URL in .env file`);
  process.exit();
}

const jsResolverSrcPath = process.argv[3] ?? "./src/resolvers/index.ts";
let chainId = 5;
let runtime: "docker" | "thread" = "thread";
let debug = false;
let showLogs = false;
let load = 10;
let pool = 10;
const inputUserArgs: { [key: string]: string } = {};
if (process.argv.length > 2) {
  process.argv.slice(3).forEach((arg) => {
    if (arg.startsWith("--debug")) {
      debug = true;
    } else if (arg.startsWith("--show-logs")) {
      showLogs = true;
    } else if (arg.startsWith("--runtime=")) {
      const type = arg.split("=")[1];
      runtime = type === "docker" ? "docker" : "thread";
    } else if (arg.startsWith("--chain-id")) {
      chainId = parseInt(arg.split("=")[1]) ?? chainId;
    } else if (arg.startsWith("--load")) {
      load = parseInt(arg.split("=")[1]) ?? load;
    } else if (arg.startsWith("--pool")) {
      pool = parseInt(arg.split("=")[1]) ?? pool;
    } else if (arg.startsWith("--user-args=")) {
      const userArgParts = arg.split("=")[1].split(":");
      if (userArgParts.length < 2) {
        console.error("Invalid user-args:", arg);
        console.error("Please use format: --user-args=[key]:[value]");
        process.exit(1);
      }
      const key = userArgParts.shift() as string;
      const value = userArgParts.join(":");
      inputUserArgs[key] = value;
    }
  });
}
const OK = colors.green("✓");
const KO = colors.red("✗");
export default async function benchmark() {
  // Build JsResolver
  const buildRes = await JsResolverBuilder.build(jsResolverSrcPath, debug);
  if (!buildRes.success) {
    console.log(`\nJsResolver Build result:`);
    console.log(` ${KO} Error: ${buildRes.error.message}`);
    return;
  }

  // Prepare mock content for test
  const context: JsResolverContextData = {
    secrets: {},
    storage: {},
    gelatoArgs: {
      chainId,
      blockTime: Date.now() / 1000,
      gasPrice: "10",
    },
    userArgs: {},
  };

  // Fill up test secrets with `SECRETS_*` env
  Object.keys(process.env)
    .filter((key) => key.startsWith("SECRETS_"))
    .forEach((key) => {
      context.secrets[key.replace("SECRETS_", "")] = process.env[key];
    });

  // Validate input user args against schema
  if (Object.keys(inputUserArgs).length > 0) {
    const runner = new JsResolverRunner(debug);
    console.log(`\nJsResolver user args validation:`);
    try {
      context.userArgs = await runner.validateUserArgs(
        buildRes.schema.userArgs,
        inputUserArgs
      );
      Object.keys(context.userArgs).forEach((key) => {
        console.log(` ${OK} ${key}:`, context.userArgs[key]);
      });
    } catch (err) {
      console.log(` ${KO} ${err.message}`);
      return;
    }
  }

  // Run JsResolver
  const start = performance.now();
  const memory = buildRes.schema.memory;
  const timeout = buildRes.schema.timeout * 1000;
  const options = { runtime, showLogs, memory, timeout };
  const script = buildRes.filePath;
  const provider = new ethers.providers.StaticJsonRpcProvider(
    process.env.PROVIDER_URL
  );
  const runner = new JsResolverRunnerPool(pool, debug);
  await runner.init();
  const promises: Promise<JsResolverExec>[] = [];
  for (let i = 0; i < load; i++) {
    console.log(`#${i} Queuing JsResolver`);
    promises.push(runner.run({ script, context, options, provider }));
    await delay(100);
  }

  const results = await Promise.all(promises);
  const duration = (performance.now() - start) / 1000;

  console.log(`\nJsResolver results:`);
  results.forEach((res, i) => {
    if (res.success) console.log(` ${OK} #${i} Success`);
    else console.log(` ${KO} #${i} Error:`, res.error);
  });
  const nbSuccess = results.filter((res) => res.success).length;
  console.log(`\nBenchmark result:`);
  console.log(`- nb success: ${nbSuccess}/${load}`);
  console.log(`- duration: ${duration.toFixed()}s`);
}
