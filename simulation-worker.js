'use strict';
importScripts('./engine.js');
self.onmessage = function (event) {
  const { id, params } = event.data;
  try {
    const result = self.PacPic.simulate(params, progress => self.postMessage({ id, progress }));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
