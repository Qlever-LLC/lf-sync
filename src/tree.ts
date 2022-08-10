// Import type { Tree } from '@oada/list-lib';

type Letter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

export type TreeKey = `${Letter | '*' | Uppercase<Letter>}${string}`;

export type Tree = {
  [key: TreeKey]: Tree;
  _type?: string;
  _rev?: number;
};

/**
 * Top level list to check/watch for all trading-partners
 */
export const MASTERID_LIST =
  '/bookmarks/trellisfw/trading-partners/masterid-index';

/**
 * List to check/watch for a trading-partner's document types
 */
export const DOCS_LIST = '/bookmarks/trellisfw/documents';

/**
 * List of all document sync's managed by `lf-sync`
 */
export const BY_LF_PATH = '/bookmarks/services/lf-sync/by-lf-id';

/**
 * Name of LF folder to watch for documents to process
 */
export const LF_AUTOMATION_FOLDER = '/_TrellisAutomation';

export const tree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    services: {
      '_type': 'application/vnd.oada.services.1+json',
      '_rev': 0,
      'lf-sync': {
        '_type': 'application/vnd.oada.service.1+json',
        '_rev': 0,
        'by-lf-id': {
          '_type': 'application/vnd.oada.service.1+json',
          '_rev': 0,
          '*': {
            _type: 'application/vnd.oada.trellisfw.1+json',
          },
        },
      },
    },
    trellisfw: {
      _type: 'application/vnd.oada.trellisfw.1+json',
      _rev: 0,
      documents: {
        '_type': 'application/vnd.oada.trellisfw.documents.1+json',
        '_rev': 0,
        '*': {
          '_type': 'application/vnd.oada.trellisfw.documentType.1+json',
          '*': {
            _type: 'application/vnd.oada.trellisfw.document.1+json',
            _rev: 0,
          },
        },
      },
    },
  },
};
