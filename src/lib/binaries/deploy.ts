import "dotenv/config";
import colors from "colors/safe";
import { Web3FunctionBuilder } from "../builder";

const OK = colors.green("✓");
const web3FunctionSrcPath = process.argv[3] ?? "./src/web3Functions/index.ts";

export default async function deploy() {
  const cid = await Web3FunctionBuilder.deploy(web3FunctionSrcPath);
  console.log(` ${OK} Web3Function deployed to ipfs. CID: ${cid}`);
}
