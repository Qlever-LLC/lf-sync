/**
 * Copyright 2022 Qlever LLC
'<,'>!e
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

import test from 'ava';

import setup from '../setup.js';

import { searchEntries } from '../../dist/cws/entries.js';

setup();

test('searchEntries', async (t) => {
  const phrase =
    '{[General]:[Document]="search text", [Date]="*"} & {LF:Name="*", Type="F"}';
  const result = await searchEntries(phrase);
  t.assert(Array.isArray(result));
});
