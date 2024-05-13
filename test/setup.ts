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

import { fileURLToPath } from 'node:url';

import { configure, setupTests } from 'ava-nock';
import test from 'ava';

// Fake the time
/*
FakeTimers.install({
  now: new Date('2022-01-01T00:00:00Z'),
  shouldAdvanceTime: true,
  advanceTimeDelta: 10,
});
*/

/**
 * Set up recording and mocking of network requests
 */
export default function setup(
  variables: Record<string, unknown> = {},
  {
    // eslint-disable-next-line unicorn/prevent-abbreviations
    fixtureDir = fileURLToPath(test.meta.snapshotDirectory),
    headerFilter,
    ...rest
  }: Parameters<typeof configure>[0] = {},
) {
  function filterVariables(input: string): string {
    let output = input;
    for (const [name, value] of Object.entries(variables)) {
      const template = `{{ ${name} }}`;
      // eslint-disable-next-line security/detect-non-literal-regexp
      output = output.replace(new RegExp(String(value), 'g'), template);
    }

    return output;
  }

  configure({
    // Fix fixture directory for esm
    fixtureDir,
    headerFilter: {
      // Don't record tokens
      'authorization': () => null,
      // Don't record content lengths?
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'content-length': () => null,
      'content-location': filterVariables,
      ...headerFilter,
    },
    pathFilter: filterVariables,
    requestBodyFilter: filterVariables,
    // ResponseBodyFilter: filterVariables,
    ...rest,
  });

  // Set up nock
  setupTests(test);
}
