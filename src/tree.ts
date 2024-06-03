/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable sonarjs/no-duplicate-string */

import type { Tree } from '@oada/types/oada/tree/v1.js';

/**
 * Top level list to check/watch for all trading-partners
 */
export const MASTERID_LIST =
  '/bookmarks/trellisfw/trading-partners/masterid-index';

export const TRADING_PARTNER_LIST = '/bookmarks/trellisfw/trading-partners';
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
        'jobs': {
          _type: 'application/vnd.oada.service..1+json',
          _rev: 0,
          reports: {
            '_type': 'application/vnd.oada.service.reports.1+json',
            '*': {
              '_type': 'application/vnd.oada.service.report.1+json',
              'day-index': {
                '*': {
                  _type: 'application/vnd.oada.service.report.1+json',
                },
              },
            },
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
          // eslint-disable-next-line no-secrets/no-secrets
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

export const selfDocsTree = JSON.parse(JSON.stringify(tree));
delete selfDocsTree?.bookmarks?.trellisfw?.documents?.['*'];

// These trees from here and below were used in the ListWatches with resume: false,
// which requires a tree. That tree must be pruned down to a minimum as the
// recursiveGet will attempt to retrieve an excessive amount of stuff.
export const masteridTree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      '_type': 'application/vnd.oada.trellisfw.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.oada.trellisfw.trading-partners.1+json',
        '*': {
          _type: 'application/vnd.oada.trellisfw.trading-partner.1+json',
        },
        'masterid-index': {
          '_type': 'application/vnd.oada.trellisfw.trading-partners.1+json',
          '*': {
            _type: 'application/vnd.oada.trellisfw.trading-partner.1+json',
          },
        },
      },
    },
  },
};

export const tradingPartnerTree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      '_type': 'application/vnd.oada.trellisfw.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.oada.trellisfw.trading-partners.1+json',
        '*': {
          _type: 'application/vnd.oada.trellisfw.trading-partner.1+json',
        },
      },
    },
  },
};

export const tpDocTypesTree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      '_type': 'application/vnd.oada.trellisfw.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.oada.trellisfw.trading-partners.1+json',
        '*': {
          _type: 'application/vnd.oada.trellisfw.trading-partner.1+json',
          bookmarks: {
            _type: 'application/vnd.oada.bookmarks.1+json',
            trellisfw: {
              _type: 'application/vnd.oada.trellisfw.1+json',
              documents: {
                // eslint-disable-next-line no-secrets/no-secrets
                '_type': 'application/vnd.oada.trellisfw.documentType.1+json',
                '*': {
                  _type: 'application/vnd.oada.trellisfw.documents.1+json',
                },
              },
            },
          },
        },
      },
    },
  },
};

export let tpTree: Tree = JSON.parse(JSON.stringify(tpDocTypesTree));
delete tpTree?.bookmarks?.trellisfw?.['trading-partners']?.['*'];

export let tpDocsTree: Tree = JSON.parse(JSON.stringify(tpDocTypesTree));
delete tpDocsTree?.bookmarks?.trellisfw?.['trading-partners']?.['*']?.bookmarks?.trellisfw?.documents?.['*'];

export const docTypesTree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    _rev: 0,
    trellisfw: {
      _type: 'application/vnd.oada.trellisfw.1+json',
      _rev: 0,
      documents: {
        '_type': 'application/vnd.oada.trellisfw.documents.1+json',
        '_rev': 0,
        '*': {
          // eslint-disable-next-line no-secrets/no-secrets
          _type: 'application/vnd.oada.trellisfw.documentType.1+json',
        },
      },
    },
  },
};
