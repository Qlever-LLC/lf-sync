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

import { Writable } from 'node:stream';

import { type DocumentEntry, type EntryIdLike, getEntryId } from './entries.js';
import cws from './api.js';

/**
 * Chunks cannot be larger than 10 MB
 */
export const MAX_CHUNK_SIZE = 1024 * 1024 * 10;

/**
 * Uploads the contents of a document by chunks
 *
 * @param document The document to which to upload contents
 * @returns A `Writeable` `Stream` that can be used to upload the contents of the document
 */
export function chunkedUpload(document: EntryIdLike<DocumentEntry>) {
  const id = getEntryId(document);
  let offset = 0;
  return new Writable({
    // Initiate the upload
    async construct(callback) {
      try {
        await cws.post<void>('api/InitUpload', {
          json: { LaserficheEntryID: id },
        });
        callback();
      } catch (error: unknown) {
        callback(error as Error);
      }
    },
    // Write a chuck at a time
    async write(chunk, _encoding, callback) {
      const body = chunk as string | Uint8Array;
      try {
        await cws.post<void>('api/UploadChunk', {
          searchParams: { offset, laserficheEntryID: id },
          body: body instanceof Uint8Array ? Buffer.from(body) : body,
        });
        offset += body.length;
        callback();
      } catch (error: unknown) {
        callback(error as Error);
      }
    },
    // Finish the upload
    async final(callback) {
      try {
        await cws.put<void>('api/CompleteUpload', {
          json: { LaserficheEntryID: id },
        });
        callback();
      } catch (error: unknown) {
        callback(error as Error);
      }
    },
  });
}

/**
 * Uploads the contents of a document by stream
 *
 * @param document The document to which to upload contents
 * @returns A `Writeable` `Stream` that can be used to upload the contents of the document
 */
export function streamUpload(
  document: EntryIdLike<DocumentEntry>,
  extension: string,
  mimetype: string,
  length: number,
): Writable {
  const id = getEntryId(document);
  return cws.stream.put(`api/Document/${id}/${extension}`, {
    headers: {
      'Content-Length': `${length}`,
      'Content-Type': mimetype,
    },
  });
}

export async function smallUpload(
  document: EntryIdLike<DocumentEntry>,
  file: Uint8Array,
) {
  const id = getEntryId(document);
  return cws.post(`api/Document/${id}`, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': `${file.length}`,
    },
    body: file instanceof Uint8Array ? Buffer.from(file) : file,
  });
}
