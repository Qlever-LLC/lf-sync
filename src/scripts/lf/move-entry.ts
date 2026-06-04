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

/* eslint-disable no-console, no-process-exit, unicorn/no-process-exit */
import { argv } from "node:process";
import { moveEntry } from "../../cws/entries.js";

/* A quick script to move an EntryId to a new location */

if (argv.length !== 4) {
  console.error("USAGE: node move-entry.js entryId path");
  process.exit(1);
}

const entryId = Number(argv[2]); // As unknown as EntryId;
const path = argv[3] as unknown as `/${string}`;

await moveEntry(entryId, path);
