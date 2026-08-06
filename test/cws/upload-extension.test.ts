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

import test from "ava";

import { resolveUploadExtension } from "../../dist/cws/upload-extension.js";

test("resolveUploadExtension uses the content type instead of generated LF name dots", (t) => {
  t.is(resolveUploadExtension({ mimetype: "application/pdf" }), "pdf");
});

test("resolveUploadExtension preserves an explicit safe extension", (t) => {
  t.is(
    resolveUploadExtension({ extension: ".txt", mimetype: "application/pdf" }),
    "txt",
  );
});
