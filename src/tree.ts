/**
 * @license
 *  Copyright 2021 Qlever LLC
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

const tree: Tree = {
  bookmarks: {
    _type: 'application/vnd.oada.bookmarks.1+json',
    trellisfw: {
      '_type': 'application/vnd.trellisfw.1+json',
      'trading-partners': {
        '_type': 'application/vnd.trellisfw.trading-partners.1+json',
        // FIXME: This *should* be a resource, but it is not right now.
        'masterid-index': {
          '*': {
            // d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e: {
            _type: 'application/vnd.trellisfw.trading-partner.1+json',
            _rev: 0,
            bookmarks: {
              _type: 'application/vnd.oada.bookmarks.1+json',
              _rev: 0,
              trellisfw: {
                _type: 'application/vnd.trellisfw.1+json',
                _rev: 0,
                documents: {
                  // eslint-disable-next-line no-secrets/no-secrets
                  '_type': 'application/vnd.trellisfw.documents.1+json',
                  '_rev': 0,
                  '*': {
                    '*': {
                      _rev: 0,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export default tree;
