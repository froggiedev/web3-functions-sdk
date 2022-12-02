import { performance } from "perf_hooks";
import axios from "axios";
import { setTimeout as delay } from "timers/promises";
import { EventEmitter } from "stream";
import { JsResolverEvent } from "../types/JsResolverEvent";
export class JsResolverHttpClient extends EventEmitter {
  private _debug: boolean;
  private _host: string;
  private _port: number;
  private _isStopped = false;

  constructor(host: string, port: number, debug = true) {
    super();
    this._host = host;
    this._port = port;
    this._debug = debug;
    this.on("input_event", this._safeSend.bind(this));
  }

  public async connect(timeout: number) {
    const retryInterval = 50;
    const end = performance.now() + timeout;
    let statusOk = false;
    while (!statusOk && !this._isStopped && performance.now() < end) {
      try {
        const res = await axios.get(`${this._host}:${this._port}/`, {
          timeout: 100,
        });
        statusOk = res.status === 200;
        this._log(`Connected to JsResolverHttpServer socket!`);
      } catch (err) {
        await delay(retryInterval);
      }
    }

    // Current instance has been stopped before we could connect
    if (this._isStopped) throw new Error(`Disconnected`);

    if (!statusOk) {
      throw new Error(
        `JsResolverHttpClient unable to connect (timeout=${timeout}ms)`
      );
    }
  }

  private async _safeSend(event: JsResolverEvent) {
    try {
      await this._send(event);
    } catch (error) {
      this.emit("error", error);
    }
  }

  private async _send(event: JsResolverEvent) {
    let res;
    try {
      res = await axios.post(`${this._host}:${this._port}`, event);
    } catch (err) {
      throw new Error(`JsResolverHttpClient request error: ${err.message}`);
    }
    try {
      const event = res.data as JsResolverEvent;
      this._log(`Received JsResolverEvent: ${event.action}`);
      this.emit("output_event", event);
    } catch (err) {
      this._log(`Error parsing message: ${err.message}`);
      console.log(res.data);
      throw new Error(`JsResolverHttpClient response error: ${err.message}`);
    }
  }
  private _log(message: string) {
    if (this._debug) console.log(`JsResolverHttpClient: ${message}`);
  }

  public end() {
    if (!this._isStopped) {
      this._isStopped = true;
    }
  }
}
