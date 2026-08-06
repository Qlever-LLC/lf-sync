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

import "@oada/pino-debug";

import type { Job, Json, WorkerContext } from "@oada/jobs";
import type Link from "@oada/types/oada/link/v1.js";
import type Resource from "@oada/types/oada/resource.js";
import equal from "deep-equal";
import { HTTPError } from "got";
import {
  createDocument,
  getCwsErrorDetails,
  getMetadata,
  moveEntry,
  renameEntry,
  retrieveEntry,
  setMetadata,
  withCwsErrorContext,
} from "./cws/index.js";
import { getTransformers } from "./transformers/index.js";
import type { LfSyncMetaData, Metadata } from "./utils.js";
import {
  fetchSyncMetadata,
  fetchTradingPartner,
  fetchVdocMeta,
  filingWorkflow,
  getBuffer,
  getPdfVdocs,
  has,
  updateSyncMetadata,
} from "./utils.js";

export interface SyncConfig {
  doc: Link;
  tpKey: string;
  tradingPartner: string;
}

type StageContext = Record<string, boolean | number | string | undefined>;

async function withStageTiming<T>(
  log: WorkerContext['log'],
  stage: string,
  context: StageContext,
  work: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await work();
    log.info(
      { ...context, durationMs: Date.now() - startedAt, stage },
      'lf-sync stage completed',
    );
    return result;
  } catch (error: unknown) {
    log.error(
      { err: error, ...context, durationMs: Date.now() - startedAt, stage },
      'lf-sync stage failed',
    );
    throw error;
  }
}

function isLaserficheEntryNotFound(error: unknown) {
  return (
    error instanceof HTTPError &&
    Buffer.from(error.response.rawBody).toString('utf8').includes('Entry not found')
  );
}

/**
 * Sync a trellis doc to LF
 */
// eslint-disable-next-line complexity, sonarjs/cognitive-complexity
export async function sync(
  job: Job,
  { oada, log }: WorkerContext,
): Promise<Json> {
  // Keeping deprecating tpKey
  const { doc, tpKey, tradingPartner } = job.config as unknown as SyncConfig;
  const documentId = doc._id;
  try {
    const { data: document } = (await withStageTiming(
      log,
      'source-fetch',
      { documentId },
      async () =>
        oada.get({
          path: `/${documentId}`,
        }),
    )) as unknown as { data: Resource };
    const transformers = getTransformers(document._type);

    if (!transformers) {
      throw new Error("Document type is unknown.");
    }

    const fieldList = await withStageTiming(
      log,
      'payload-base-transform',
      { documentId, documentType: document._type },
      async () => transformers.doc(document),
    );

    if (!(tradingPartner || tpKey)) {
      throw new Error("No trading partner key or id provided");
    }

    const tradingPartnerId = tradingPartner || tpKey;
    const { name, externalIds } = await withStageTiming(
      log,
      'trading-partner-fetch',
      { documentId, tradingPartnerId },
      async () => fetchTradingPartner(oada, tradingPartnerId),
    );
    fieldList.Entity = name.toString() ?? "";
    const xIds = externalIds
      .filter((xid: string) => xid.startsWith("sap:"))
      .map((xid: string) => xid.replace(/^sap:/, ""))
      .join(",");
    fieldList["SAP Number"] = xIds;

    if (!fieldList["Share Mode"]) {
      try {
        const { data: shareMode } = (await oada.get({
          path: `/${document._id}/_meta/shared`,
        })) as unknown as { data: string };
        fieldList["Share Mode"] =
          shareMode === "incoming"
            ? "Shared To Smithfield"
            : "Shared From Smithfield";
      } catch (error_: unknown) {
        // @ts-expect-error error nonsense
        if (error_.status !== 404 || error_.code !== "404") throw error_;
        fieldList["Share Mode"] = "incoming";
      }
    }

    const docsSyncMetadata: Record<string, LfSyncMetaData> = {};

    log.trace("Fetching vdocs for %s", document._id);
    const vdocs = await withStageTiming(
      log,
      "vdocs-fetch",
      { documentId },
      async () => getPdfVdocs(oada, document),
    );

    // Each "vdoc" is a single LF Document (In trellis "documents" have multiple attachments)
    for await (const [key, value] of Object.entries(vdocs)) {
      // TODO: Remove when target-helper vdoc extra link bug is fixed
      if (key === "_id") continue;

      const vdocContext = {
        documentId,
        documentType: document._type,
        tradingPartnerId,
        tradingPartnerName: name.toString(),
        vdocKey: key,
        vdocResourceId: value._id,
      };

      // Prep the fields list with
      const fields = {
        ...fieldList,
        ...(transformers.vdoc
          ? await withStageTiming(
              log,
              'payload-vdoc-transform',
              vdocContext,
              async () => transformers.vdoc(await fetchVdocMeta(oada, value._id)),
            )
          : {}),
      };

      const syncMetadata = await withStageTiming(
        log,
        'sync-metadata-fetch',
        vdocContext,
        async () => fetchSyncMetadata(oada, document._id, key, log),
      );
      const syncMetaCopy = { ...syncMetadata };
      let currentFields: LfSyncMetaData["fields"] = {};

      // Document is not new to LF
      if (syncMetadata.LaserficheEntryID) {
        const laserficheEntryId = syncMetadata.LaserficheEntryID;
        // Fetch the current LF fields to compare for changes
        try {
          const metadata = await withStageTiming(
            log,
            'laserfiche-metadata-fetch',
            {
              ...vdocContext,
              laserficheEntryId: Number(laserficheEntryId),
            },
            async () => getMetadata(laserficheEntryId),
          );
          // Only keep fields that have a value
          // eslint-disable-next-line unicorn/no-array-reduce
          currentFields = metadata.LaserficheFieldList.reduce(
            (o, f) =>
              has(f, "Value") && f.Value !== ""
                ? { ...o, [f.Name]: f.Value }
                : o,
            {},
          );
        } catch (error) {
          // Document was removed from Laserfiche, process it like it is new.
          syncMetadata.LaserficheEntryID = isLaserficheEntryNotFound(error)
            ? undefined
            : syncMetadata.LaserficheEntryID;
        }
      }

      syncMetadata.fields ||= {};

      currentFields = { ...syncMetadata.fields, ...currentFields };

      // Only take new automation values if not manually changed in the past
      for (const [k, v] of Object.entries(fields)) {
        if (syncMetadata.fields[k] === currentFields[k]) {
          currentFields[k] = v;
        }
      }

      syncMetadata.fields = currentFields;

      // Aka, an empty object
      if (Object.keys(syncMetadata.fields).length === 0) {
        log.trace(`Document vdoc ${key} has no data yet. Skipping.`);
        continue;
      }

      const { path, filename } = filingWorkflow(
        syncMetadata.fields as unknown as Metadata,
      );

      // Upsert into LF
      if (syncMetadata.LaserficheEntryID) {
        const laserficheEntryId = syncMetadata.LaserficheEntryID;
        const syncFields = syncMetadata.fields ?? {};
        log.info(
          `LF Entry ${laserficheEntryId} (vdoc ${key}) already exists. Updating.`,
        );
        await withStageTiming(
          log,
          "laserfiche-update",
          {
            ...vdocContext,
            laserficheEntryId: Number(laserficheEntryId),
            targetPath: path,
          },
          async () => {
            await setMetadata(
              laserficheEntryId,
              syncFields,
              syncFields["Document Type"],
            );

            log.trace(`Moving the LF document to ${path} with name ${filename}`);
            // Use our own filing workflow instead of incomingFolder
            await moveEntry(laserficheEntryId, path);
            // Rename is different from Metadata, but should be part of upsert
            await renameEntry(laserficheEntryId, path, filename);
          },
        );

        // New to LF
      } else {
        log.info(`Document (vdoc ${key}) is new to LF`);

        const { buffer, mimetype } = await withStageTiming(
          log,
          "attachment-fetch",
          vdocContext,
          async () => getBuffer(log, oada, value),
        );
        log.trace("Uploading document to Laserfiche");
        const syncFields = syncMetadata.fields ?? {};
        const lfDocument = await withStageTiming(
          log,
          "laserfiche-submit",
          {
            ...vdocContext,
            byteLength: buffer.length,
            filename,
            mimetype,
            targetPath: path,
          },
          async () =>
            withCwsErrorContext(
              createDocument({
                // Name: `${document._id}-${key}.${extname(syncMetadata.fields['Original Filename'] ?? '').slice(1)}`,
                name: filename,
                path,
                mimetype,
                metadata: syncFields,
                template: syncFields["Document Type"],
                buffer,
                onCreated: ({ LaserficheEntryID }) => {
                  log.info(
                    {
                      ...vdocContext,
                      filename,
                      laserficheEntryId: Number(LaserficheEntryID),
                      targetPath: path,
                    },
                    "Created LF document entry before content upload",
                  );
                },
              }),
              {
                request: {
                  documentType: document._type,
                  filename,
                  generatedLaserfichePath: path,
                  tradingPartnerId,
                  tradingPartnerName: name.toString(),
                  vdocKey: key,
                  vdocResourceId: value._id,
                },
              },
            ),
        );

        log.info(
          `Created LF document ${lfDocument.LaserficheEntryID} (vdoc ${key})`,
        );
        syncMetadata.LaserficheEntryID = lfDocument.LaserficheEntryID;
      }

      const laserficheEntryId = syncMetadata.LaserficheEntryID;
      if (!laserficheEntryId) {
        throw new Error(`No Laserfiche entry ID recorded for vdoc ${key}.`);
      }

      const entry = await withStageTiming(
        log,
        'laserfiche-entry-fetch',
        {
          ...vdocContext,
          laserficheEntryId: Number(laserficheEntryId),
        },
        async () =>
          retrieveEntry({
            LaserficheEntryID: laserficheEntryId,
          }),
      );

      syncMetadata.Name = entry.Name;
      syncMetadata.Path = entry.Path;

      log.trace("Recording lf-sync metadata to Trellis document");

      // Update the sync metadata in Trellis only if it has actually changed
      if (!equal(syncMetaCopy, syncMetadata)) {
        await withStageTiming(
          log,
          'sync-metadata-update',
          {
            ...vdocContext,
            laserficheEntryId: Number(laserficheEntryId),
          },
          async () => updateSyncMetadata(oada, document, key, syncMetadata),
        );
      }

      docsSyncMetadata[key] = entry;
    }

    return docsSyncMetadata as unknown as Json;
  } catch (error_: unknown) {
    const cws = getCwsErrorDetails(error_);
    if (cws) {
      log.error(
        { cws, documentId, err: error_ },
        `Could not sync document ${documentId}.`,
      );
    } else {
      log.error(error_, `Could not sync document ${documentId}.`);
    }

    throw error_;
  }
}
