// CSP restricts HTTP requests. WebRTC has separate networking, so remove its
// constructors before untrusted code runs, including in any initial blank frame.
(() => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
  }
})();
