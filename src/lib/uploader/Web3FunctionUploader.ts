import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import tar from "tar";
import FormData from "form-data";
import axios from "axios";
import { JsResolverSchema } from "../types";

const OPS_USER_API =
  process.env.OPS_USER_API ?? "https://api.gelato.digital/automate/users";
export class JsResolverUploader {
  public static async uploadResolver(
    schemaPath: string,
    filePath: string,
    sourcePath: string
  ): Promise<string> {
    try {
      const compressedPath = await this.compress(
        filePath,
        schemaPath,
        sourcePath
      );

      const cid = await this._userApiUpload(compressedPath);

      return cid;
    } catch (err) {
      throw new Error(`JsResolverUploaderError: ${err.message}`);
    }
  }

  public static async fetchResolver(
    cid: string,
    destDir = "./.tmp"
  ): Promise<string> {
    try {
      const res = await axios.get(`${OPS_USER_API}/users/js-resolver/${cid}`, {
        responseEncoding: "binary",
        responseType: "arraybuffer",
      });

      // store jsResolver file in .tmp
      let jsResolverPath: string;

      const jsResolverFileName = `${cid}.tgz`;
      const tempJsResolverPath = `.tmp/${jsResolverFileName}`;

      if (!fs.existsSync(".tmp")) {
        fs.mkdirSync(".tmp", { recursive: true });
      }

      await fsp.writeFile(tempJsResolverPath, res.data);
      jsResolverPath = tempJsResolverPath;

      // store jsResolver to custom dir
      if (destDir !== "./.tmp") {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        const customJsResolverPath = `${destDir}/${jsResolverFileName}`;
        await fsp.rename(jsResolverPath, customJsResolverPath);
        jsResolverPath = customJsResolverPath;
      }

      return jsResolverPath;
    } catch (err) {
      let errMsg = `${err.message} `;
      if (axios.isAxiosError(err)) {
        const data = JSON.parse(err.response?.data.toString("utf8")) as {
          message?: string;
        };
        if (data.message) errMsg += data.message;
      }

      throw new Error(
        `JsResolverUploaderError: Fetch JsResolver to ${destDir} failed. \n${errMsg}`
      );
    }
  }

  public static async compress(
    jsResolverBuildPath: string,
    schemaPath: string,
    sourcePath: string
  ): Promise<string> {
    try {
      await fsp.access(jsResolverBuildPath);
    } catch (err) {
      throw new Error(
        `JsResolver build file not found at path. ${jsResolverBuildPath} \n${err.message}`
      );
    }
    const { base } = path.parse(jsResolverBuildPath);

    // create directory with index.js, source.js & schema.json
    const folderCompressedName = `jsResolver`;
    const folderCompressedPath = `.tmp/${folderCompressedName}`;
    const folderCompressedTar = `${folderCompressedPath}.tgz`;

    if (!fs.existsSync(folderCompressedPath)) {
      fs.mkdirSync(folderCompressedPath, { recursive: true });
    }

    // move files to directory
    await fsp.rename(jsResolverBuildPath, `${folderCompressedPath}/index.js`);
    await fsp.rename(sourcePath, `${folderCompressedPath}/source.js`);
    try {
      await fsp.copyFile(schemaPath, `${folderCompressedPath}/schema.json`);
    } catch (err) {
      throw new Error(
        `Schema not found at path: ${schemaPath}. \n${err.message}`
      );
    }

    const stream = tar
      .c(
        {
          gzip: true,
          cwd: `${process.cwd()}/.tmp`,
          noMtime: true,
          portable: true,
        },
        [folderCompressedName]
      )
      .pipe(fs.createWriteStream(folderCompressedTar));

    await new Promise((fulfill) => {
      stream.once("finish", fulfill);
    });

    // delete directory after compression
    await fsp.rm(folderCompressedPath, { recursive: true });

    return folderCompressedTar;
  }

  public static async extract(input: string): Promise<{
    dir: string;
    schemaPath: string;
    sourcePath: string;
    jsResolverPath: string;
  }> {
    try {
      const { dir, name } = path.parse(input);

      // rename directory to ipfs cid of resolver if possible.
      const cidDirectory = `${dir}/${name}`;
      if (!fs.existsSync(cidDirectory)) {
        fs.mkdirSync(cidDirectory, { recursive: true });
      }

      await tar.x({ file: input, cwd: cidDirectory });

      // remove tar file
      fs.rmSync(input, { recursive: true });

      // move resolver & schema to root ipfs cid directory
      fs.renameSync(
        `${cidDirectory}/jsResolver/schema.json`,
        `${cidDirectory}/schema.json`
      );
      fs.renameSync(
        `${cidDirectory}/jsResolver/index.js`,
        `${cidDirectory}/index.js`
      );
      fs.renameSync(
        `${cidDirectory}/jsResolver/source.js`,
        `${cidDirectory}/source.js`
      );

      // remove jsResolver directory
      fs.rmSync(`${cidDirectory}/jsResolver`, { recursive: true });

      return {
        dir: `${cidDirectory}`,
        schemaPath: `${cidDirectory}/schema.json`,
        sourcePath: `${cidDirectory}/source.js`,
        jsResolverPath: `${cidDirectory}/index.js`,
      };
    } catch (err) {
      throw new Error(
        `JsResolverUploaderError: Extract JsResolver from ${input} failed. \n${err.message}`
      );
    }
  }

  public static async fetchSchema(cid: string): Promise<JsResolverSchema> {
    try {
      const jsResolverPath = await JsResolverUploader.fetchResolver(cid);

      const { dir, schemaPath } = await JsResolverUploader.extract(
        jsResolverPath
      );

      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

      fs.rmSync(dir, { recursive: true });

      return schema;
    } catch (err) {
      throw new Error(
        `JsResolverUploaderError: Get schema of ${cid} failed: \n${err.message}`
      );
    }
  }

  private static async _userApiUpload(compressedPath: string): Promise<string> {
    try {
      const form = new FormData();
      const file = fs.createReadStream(compressedPath);

      form.append("title", "JsResolver");
      form.append("file", file);

      const res = await axios.post(`${OPS_USER_API}/users/js-resolver`, form, {
        ...form.getHeaders(),
      });

      const cid = res.data.cid;

      // rename file with cid
      const { dir, ext } = path.parse(compressedPath);
      await fsp.rename(compressedPath, `${dir}/${cid}${ext}`);

      return cid;
    } catch (err) {
      let errMsg = `${err.message} `;
      if (axios.isAxiosError(err)) {
        const data = err?.response?.data as { message?: string };
        if (data.message) errMsg += data.message;
      }

      throw new Error(`Upload to User api failed. \n${errMsg}`);
    }
  }
}
