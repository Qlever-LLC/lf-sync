/**
 * Copyright 2022 Open Ag Data Alliance
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

declare module 'isomorphic-timers-promises' {
  export * from 'node:timers/promises';
}

declare module 'ava-nock' {
  import { Scope } from 'nock';
  import type { TestFn } from 'ava';
  interface Options {
    /** @default true */
    decodeResponse: boolean;
    fixtureDir: string;
    headerFilter: Record<
      string,
      // eslint-disable-next-line @typescript-eslint/ban-types
      | ((header: string) => string | null)
      | Parameters<typeof String.prototype.replace>
    >;
    pathFilter: ((path: string) => string) | Parameters<Scope['filteringPath']>;
    requestBodyFilter:
      | ((body: string) => string)
      | Parameters<Scope['filteringRequestBody']>;
    responseBodyFilter:
      | ((body: string) => string)
      | Parameters<typeof String.prototype.replace>;
  }
  export function configure(options: Partial<Options>): void;
  export function setupTests(test: TestFn): void;
}
