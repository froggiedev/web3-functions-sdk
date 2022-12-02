import {
  JsResolverSdk,
  JsResolverContext,
} from "@gelatonetwork/js-resolver-sdk";

const delay = (time: number) => new Promise((res) => setTimeout(res, time));

JsResolverSdk.onChecker(async (context: JsResolverContext) => {
  await delay(3600_000);
  return { canExec: false, message: "Sandbox escaped timeout" };
});
