import "dotenv/config";
import colors from "colors/safe";
import { JsResolverBuilder } from "@gelatonetwork/js-resolver-sdk/builder";
import { JsResolverUploader } from "@gelatonetwork/js-resolver-sdk/uploader";

const OK = colors.green("✓");
const KO = colors.red("✗");
const jsResolverSrcPath = process.argv[2] ?? "./src/resolvers/index.ts";

const upload = async () => {
  const buildRes = await JsResolverBuilder.build(jsResolverSrcPath, false);

  if (!buildRes.success) throw buildRes.error;

  const cid = await JsResolverUploader.uploadResolver();
  console.log(` ${OK} JsResolver uploaded to ipfs. CID: ${cid}`);
};

upload().catch((err) => console.error(` ${KO} ${err.message}`));
