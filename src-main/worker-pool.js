const { Worker } = require('worker_threads');
const os = require('os');

class WorkerPool {
  constructor(workerScript, numThreads = Math.max(2, os.cpus() ? os.cpus().length : 4)) {
    this.workerScript = workerScript;
    this.numThreads = numThreads;
    this.workers = [];
    this.freeWorkers = [];
    this.taskQueue = [];
    this.nextTaskId = 1;
    this.activeTaskMap = new Map();
    this.init();
  }

  init() {
    for (let i = 0; i < this.numThreads; i++) {
      this.createWorker();
    }
  }

  createWorker() {
    try {
      const worker = new Worker(this.workerScript);
      worker.on('message', (message) => {
        const { id } = message;
        const task = this.activeTaskMap.get(id);
        if (task) {
          this.activeTaskMap.delete(id);
          this.freeWorkers.push(worker);
          task.resolve(message);
          this.processQueue();
        }
      });
      worker.on('error', (err) => {
        for (const [id, task] of this.activeTaskMap.entries()) {
          if (task.worker === worker) {
            this.activeTaskMap.delete(id);
            task.reject(err);
            break;
          }
        }
        const idx = this.workers.indexOf(worker);
        if (idx !== -1) this.workers.splice(idx, 1);
        const freeIdx = this.freeWorkers.indexOf(worker);
        if (freeIdx !== -1) this.freeWorkers.splice(freeIdx, 1);
        this.createWorker();
        this.processQueue();
      });
      this.workers.push(worker);
      this.freeWorkers.push(worker);
    } catch (e) {
      // Fallback if worker threads fail to instantiate
    }
  }

  exec(payload) {
    return new Promise((resolve, reject) => {
      const id = this.nextTaskId++;
      const task = { id, payload, resolve, reject };
      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  processQueue() {
    while (this.taskQueue.length > 0 && this.freeWorkers.length > 0) {
      const task = this.taskQueue.shift();
      const worker = this.freeWorkers.pop();
      task.worker = worker;
      this.activeTaskMap.set(task.id, task);
      worker.postMessage({ id: task.id, ...task.payload });
    }
  }

  terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.freeWorkers = [];
    this.taskQueue = [];
    this.activeTaskMap.clear();
  }
}

module.exports = WorkerPool;
