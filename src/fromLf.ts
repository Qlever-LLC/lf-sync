import config from './config.js';

import debug from 'debug';
import { browse } from './cws/folders.js';

const LF_POLL_RATE = config.get('laserfiche.pollRate');

// LF Document ID
export type DocumentTasks = Set<number>;

const trace = debug('lf-sync:from-lf:trace');
const warn = debug('lf-sync:from-lf:warn');

const workQueue = new Map<number, number>();

// A never ending generator that polls LF for work to do.
// It wont report the same document twice, unless more than 100s
// have gone by and it is still present.
export async function* fetchLfTasks() {
  while (true) {
    const start = new Date();

    for (let [id, startTime] of workQueue.entries()) {
      if (start.getTime() > startTime + 100 * 1000) {
        warn(`LF ${id} work never completed. Now eligible for re-queuing.`);
        workQueue.delete(id);
      }
    }

    trace(`${start.toISOString()} Polling LaserFiche.`);

    let files = await browse('/_Trellis_Automation');
    for (const file of files) {
      if (!workQueue.has(file.EntryId)) {
        workQueue.set(file.EntryId, Date.now());
        yield file;
      }
    }

    // Delay until next poll window
    let n = start.getTime() - (start.getTime() % LF_POLL_RATE) + LF_POLL_RATE;
    await new Promise((r) => setTimeout(r, n - Date.now()));
  }
}

// Allows service to report that the work for LF document is done.
// Strictly not required, but if used allows the same LF document to
// be re-queued quickly by the user.
export function finishedWork(id: number) {
  workQueue.delete(id);
}
