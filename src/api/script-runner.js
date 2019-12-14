// @flow
import invariant from "invariant";
import { log } from "@ledgerhq/logs";
import type Transport from "@ledgerhq/hw-transport";
import { concat, from, Observable, Subject, of, empty } from "rxjs";
import { concatMap, map, takeWhile } from "rxjs/operators";
import { WebSocketSubject } from "rxjs/webSocket";
import {
  WebsocketConnectionError,
  WebsocketConnectionFailed,
  DeviceSocketFail,
  DeviceSocketNoBulkStatus,
  DisconnectedDeviceDuringOperation
} from "@ledgerhq/errors";
import { cancelDeviceAction } from "../hw/deviceAccess";
import { getWebSocketCtor } from "../network";

export type SocketEvent =
  | {
      type: "bulk-progress",
      progress: number,
      index: number,
      total: number
    }
  | {
      type: "result",
      payload: any
    }
  | {
      type: "warning",
      message: string
    }
  | {
      type: "exchange-before",
      nonce: number,
      apdu: Buffer
    }
  | {
      type: "exchange",
      nonce: number,
      apdu: Buffer,
      data: Buffer,
      status: Buffer
    }
  | {
      type: "opened"
    }
  | {
      type: "closed"
    };

type MsgIn = {
  query: string,
  data: mixed,
  nonce: number
};

type MsgOut = {
  nonce: number,
  response: "success" | "error",
  data: string
};

type Handlers = {
  [_: *]: (
    MsgIn,
    WebSocketSubject<mixed>,
    Transport<*>
  ) => Observable<SocketEvent>
};

const asMsgOut = (out: MsgOut): * => out;
const asMsgIn = (input: mixed): MsgIn => input;

const handlers: Handlers = {
  exchange: ({ nonce, data }, socket, transport) => {
    const apdu = Buffer.from(data, "hex");
    return concat(
      of({ type: "exchange-before", nonce, apdu }),
      from(transport.exchange(apdu)).pipe(
        map(r => {
          const status = r.slice(r.length - 2);
          const data = r.slice(0, r.length - 2);
          const strStatus = status.toString("hex");
          socket.next(
            asMsgOut({
              nonce,
              response: strStatus === "9000" ? "success" : "error",
              data: data.toString("hex")
            })
          );
          return { type: "exchange", nonce, apdu, status, data };
        })
      )
    );
  },

  bulk: async ({ data, nonce }, socket, transport) => {
    if (!Array.isArray(data)) return empty();

    return Observable.create(o => {
      let interrupted = false;

      async function main() {
        o.next({
          type: "bulk-progress",
          progress: 0,
          index: 0,
          total: data.length
        });

        // Execute all apdus and collect last status
        let lastStatus = null;
        for (let i = 0; i < data.length; i++) {
          const apdu = data[i];
          const r: Buffer = await transport.exchange(Buffer.from(apdu, "hex"));
          lastStatus = r.slice(r.length - 2);
          if (lastStatus.toString("hex") !== "9000") break;
          if (interrupted) return;
          o.next({
            type: "bulk-progress",
            progress: (i + 1) / data.length,
            index: i + 1,
            total: data.length
          });
        }

        if (!lastStatus) {
          throw new DeviceSocketNoBulkStatus();
        }

        const strStatus = lastStatus.toString("hex");

        /*
        if (ignoreWebsocketErrorDuringBulk && ws.readyState !== 1) {
          terminated = true;
          */
        o.next({
          type: "result",
          payload: lastStatus ? lastStatus.toString("hex") : ""
        });
        /*
        } else {
          */
        socket.next({
          nonce,
          response: strStatus === "9000" ? "success" : "error",
          data: strStatus === "9000" ? "" : strStatus
        });
        /*
        }
        */
        o.complete();
      }

      main().catch(e => o.error(e));

      return () => {
        interrupted = true;
      };
    });

    /*
    return concat(
      of({
        type: "bulk-progress",
        progress: 0,
        index: 0,
        total: data.length
      }),
      // Execute all apdus and collect last status
      from(data).pipe(
        concatMap(apdu =>
          from(transport.exchange(Buffer.from(apdu, "hex"))).pipe(
            map(r => ({
              type: "bulk-progress",
              progress: (i + 1) / data.length,
              index: i + 1,
              total: data.length,
              status: r.slice(r.length - 2)
            }))
          )
        ),
        takeWhile(e => e.status === "9000")
      )
    );
    */

    /*
    inBulk = true;
    try {
      const { data, nonce } = input;

      o.next({
        type: "bulk-progress",
        progress: 0,
        index: 0,
        total: data.length
      });

      // Execute all apdus and collect last status
      let lastStatus = null;
      for (let i = 0; i < data.length; i++) {
        const apdu = data[i];
        const r: Buffer = await transport.exchange(
          Buffer.from(apdu, "hex")
        );
        lastStatus = r.slice(r.length - 2);
        if (lastStatus.toString("hex") !== "9000") break;
        if (interrupted) return;
        o.next({
          type: "bulk-progress",
          progress: (i + 1) / data.length,
          index: i + 1,
          total: data.length
        });
      }

      if (!lastStatus) {
        throw new DeviceSocketNoBulkStatus();
      }

      const strStatus = lastStatus.toString("hex");

      if (ignoreWebsocketErrorDuringBulk && ws.readyState !== 1) {
        terminated = true;
        o.next({
          type: "result",
          payload: lastStatus ? lastStatus.toString("hex") : ""
        });
        o.complete();
      } else {
        send(
          nonce,
          strStatus === "9000" ? "success" : "error",
          strStatus === "9000" ? "" : strStatus
        );
      }
    } finally {
      inBulk = false;
    }
    */
  }
};

const createDeviceSocket = (
  transport: Transport<*>,
  {
    url,
    ignoreWebsocketErrorDuringBulk
  }: {
    url: string,
    // ignoreWebsocketErrorDuringBulk is a workaround to continue bulk even if the ws connection is termined
    // the WS connection can be terminated typically because ws timeout
    ignoreWebsocketErrorDuringBulk?: boolean
  }
): Observable<SocketEvent> =>
  Observable.create(o => {
    const WebSocketCtor = getWebSocketCtor();

    const openObserver = new Subject();
    const closingObserver = new Subject();
    const closeObserver = new Subject();

    const socket: WebSocketSubject<mixed> = new WebSocketSubject({
      url,
      WebSocketCtor,
      openObserver,
      closingObserver,
      closeObserver
    });

    closingObserver.subscribe(e => {
      console.log("closing", e);
    });

    /*

      if (!terminated) {
        cancelDeviceAction(transport);
      }
      */

    /*

        log({
          type: "socket-message-error",
          message: err.message,
          stack: err.stack
        });
        */

    return socket
      .pipe(
        concatMap(input => {
          const msg = asMsgIn(input);
          log("wssr-receive", msg.query, msg);
          const handler = handlers[msg.query];
          if (!handler) {
            console.warn(`Cannot handle msg of type ${msg.query}`, {
              query: msg.query,
              url
            });
            return empty();
          }

          return handler(msg, socket, transport);
        })
      )
      .subscribe(o);
  });
