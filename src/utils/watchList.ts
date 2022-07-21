import { join } from 'node:path';
import debug from 'debug';
import type { OADAClient } from '@oada/client';
import { ListWatch } from '@oada/list-lib';

const warn = debug('lf-sync:watchList:warn');

export function watchList(oada: OADAClient, path: string) {
  const watches = new Map<string, ListWatch>();

  const watch = new ListWatch({
    conn: oada,
    name: 'lf-sync:to-lf-own',
    resume: false,
    path,
    onAddItem(_, key) {
      if (watches.has(key)) {
        // FIXME: This this a real concern?
        warn(`Duplicate watch ${join(path, key)}`);
        return;
      }
      watches.set(key, watch);
    },
  });

  // FIXME: Shouldn't @oada/list-lib do this if important?
  process.on('beforeExit', watch.stop);
}
