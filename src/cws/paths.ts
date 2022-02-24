/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import config from '../config.js';

import { join, sep } from 'node:path';

const { baseFolder } = config.get('laserfiche');

const test = process.env.NODE_ENV === 'test';

export type Path = `/${string}`;

/**
 * Normalize to `\\` path separators
 */
export function normalizePath(path: Path) {
  // Check for config updates in tests?
  const base = test
    ? config.get('laserfiche.baseFolder')
    : /* c8 ignore next */ baseFolder;
  return join(base, path).split(sep).join('\\') as `\\${string}`;
}
