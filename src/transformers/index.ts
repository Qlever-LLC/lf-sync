import type { Metadata } from '../cws';
import { coiMetadata } from './coi.js';

type Transformer = {
  lfTemplate: string;
  metadata: (doc: any) => Metadata;
};

export default new Map<String, Transformer>([
  [
    'application/vnd.trellisfw.coi.accord.1+json',
    {
      lfTemplate: 'SFI - Template 1',
      metadata: coiMetadata,
    },
  ],
]);
