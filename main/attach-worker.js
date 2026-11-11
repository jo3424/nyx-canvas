'use strict';
const { parentPort, workerData } = require('worker_threads');
const attach = require('./attach');
(async () => {
  try {
    const op = workerData && workerData.op;
    if (op === 'inspect') {
      parentPort.postMessage(await attach.inspect(workerData.file, workerData.opts || {}));
    } else if (op === 'unzip') {
      parentPort.postMessage(await attach.unzipSafe(workerData.src, workerData.dest, workerData.opts || {}));
    } else {
      parentPort.postMessage({ error: 'unknown op', code: 'OP' });
    }
  } catch (e) {
    parentPort.postMessage({ error: String(e.message || e), code: e.code || 'WORKER' });
  }
})();
