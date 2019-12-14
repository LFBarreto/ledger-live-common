// @flow

let networkFn: ?Function = null;
let WebSocket: ?Function = global.WebSocket; // eslint-disable-line

export const setNetwork = (fn: *) => {
  networkFn = fn;
};

export const setWebSocketImplementation = (wsimpl: *) => {
  WebSocket = wsimpl;
};

export const getWebSocketCtor = () => {
  if (!WebSocket) {
    throw new Error(
      "live-common: no WebSocket implementation is available. use setWebSocketImplementation"
    );
  }
  return WebSocket;
};

export const createWebSocket = (url: string) => {
  console.warn("createWebSocket deprecated");
  const Ctor = getWebSocketCtor();
  return new Ctor(url);
};

export default (...args: *) => {
  if (!networkFn) {
    throw new Error(
      "live-common: no network function defined. need to call setNetwork()"
    );
  }
  return networkFn(...args);
};
