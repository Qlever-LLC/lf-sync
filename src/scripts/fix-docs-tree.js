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

/* eslint-disable no-console */

import { join } from "node:path";
import { connect } from "@oada/client";
import { config } from "../dist/config.js";

const { token: tokens, domain } = config.get("oada");

setInterval(() => console.log("TICK"), 1000);

const oada = await connect({ token: tokens[0] || "", domain });
const tpPath = "/bookmarks/trellisfw/trading-partners";

const { data: masterIds } = await oada.get({ path: tpPath });

dropTrellis(masterIds);
delete masterIds[""];
delete masterIds.bookmarks;
delete masterIds.smithfield;

// Loop over all master ids
for await (const [index, tpKey] of Object.keys(masterIds).entries()) {
  try {
    // Fix up the trading-partner's /bookmarks/trellisfw endpoint
    console.log(`Master id ${index} / ${Object.keys(masterIds).length}`);
    const trellisPath = join(tpPath, tpKey, "/bookmarks/trellisfw");
    const { data: trellisResult } = await oada.get({ path: trellisPath });
    console.log(`Trellis result: ${JSON.stringify(trellisResult, 0, 2)}`);
    await ensureResource(
      trellisPath,
      trellisResult,
      "application/vnd.trellis.1+json",
    );
    await oada.delete({
      path: `${trellisPath}/_meta/oada-list-lib`,
    });

    // Fix up the trading-partner's /bookmarks/trellisfw/documents endpoint
    const docsPath = join(tpPath, tpKey, "/bookmarks/trellisfw/documents");
    const { data: docs } = await oada.get({ path: docsPath });
    console.log(`Docs result: ${JSON.stringify(docs, 0, 2)}`);
    await ensureResource(
      docsPath,
      docs,
      "application/vnd.trellis.documents.1+json",
    );
    await oada.delete({
      path: `${docsPath}/_meta/oada-list-lib`,
    });
    dropTrellis(docs);

    // Fix up the trading-partner's /bookmarks/trellisfw/documents/<document type> endpoints
    for await (const documentType of Object.keys(docs)) {
      const docTypePath = join(docsPath, documentType);
      const docTypeLink = docs[documentType];
      // Known mistake keys
      if (
        documentType === "name" ||
        documentType === "code" // ||
        //      documentType === 'documents'
      ) {
        await oada.delete({ path: docTypePath });
        continue;
      }

      // Idk what type 'documents' is, check it out and see if any of them actually contain anything
      if (documentType === "documents") {
        // Is the thing just a broken, unlinked _meta thing here without any actual docs?
        if (
          docTypeLink._meta &&
          !isLink(docTypeLink._meta) &&
          Object.keys(docTypeLink).length === 1
        ) {
          console.log(`looks like a broken 'documents' doc type. Deleting...`);
          await oada.delete({ path: docTypePath });
          continue;
        }
        console.log(`Weird 'documents' object`, docTypePath);
        // We can come back and put code in here later
        continue;
      }

      const { data: docType } = await oada.get({ path: docTypePath });
      await ensureResource(docTypePath, docType, documentType);
      await fixListLibraryEntry(docTypePath, tpKey, documentType);
    }
  } catch (error) {
    console.log(error);
  }
}

/* Go from
{
  "oada-list-lib": {
    "lf-sync:to-lf:": {
      "7f71564d54f41eae5e14018f45572e902e2cd348ab90223cea13b4410395803b:": { // Old masterid
        "cois": {
          "_id": "resources/29xI62MyvYOv7Mse8TKsQfatLqj"
        }
      },
      "60d21bc1aeb961000ea58c77:": {
        "cois": {
          "_id": "resources/2T1aj4qEyYWMdgihCgW44QwnlEw"
        }
      }
    }
  }
}
to
{ "oada-list-lib": {
    "lf-sync:to-lf:60d21bc1aeb961000ea58c77:cois": {
      "_id": "resources/29xI62MyvYOv7Mse8TKsQfatLqj"
    }
  }
}
*/
async function fixListLibraryEntry(path, tpKey, docType, _list) {
  try {
    const { data: listLibraryEntry } = await oada.get({
      path: `${path}/_meta/oada-list-lib`,
    });

    const newEntry = structuredClone(listLibraryEntry);
    const newEntryName = `lf-sync:to-lf:${tpKey}:${docType}`;
    const weirdMasterid = `${tpKey}:`;

    // Find old list lib entry using new style masterids
    const hasMasterid = listLibraryEntry?.["lf-sync:to-lf:"]?.[weirdMasterid];
    const hasMasteridDocType =
      hasMasterid && listLibraryEntry["lf-sync:to-lf:"][weirdMasterid][docType];

    // Find old list lib entry using old style masterids
    const hasOldMasterid =
      listLibraryEntry?.["lf-sync:to-lf:"] &&
      Object.keys(listLibraryEntry["lf-sync:to-lf:"]).some(
        (key) => key !== weirdMasterid,
      );
    const oldMasterids =
      (hasOldMasterid &&
        Object.keys(listLibraryEntry["lf-sync:to-lf:"]).filter(
          (key) => key !== weirdMasterid,
        )) ||
      [];
    const oldMasterid =
      hasOldMasterid &&
      Object.keys(listLibraryEntry["lf-sync:to-lf:"]).find(
        (key) => key !== weirdMasterid,
      );
    if (oldMasterids.length > 1) {
      console.log("uh oh, multiple old masterids found here...");
    }

    const hasOldMasteridDocType =
      hasOldMasterid &&
      listLibraryEntry["lf-sync:to-lf:"][oldMasterid][docType];

    // Find current list lib entry using
    const hasNewEntry = hasMasterid && listLibraryEntry[newEntryName];

    if (hasNewEntry) {
      newEntry[newEntryName] = listLibraryEntry[newEntryName];
    } else if (hasMasteridDocType) {
      newEntry[newEntryName] =
        listLibraryEntry["lf-sync:to-lf:"][weirdMasterid][docType];
    } else if (hasOldMasteridDocType) {
      newEntry[newEntryName] =
        listLibraryEntry["lf-sync:to-lf:"][oldMasterid][docType];
    }

    delete newEntry["lf-sync:to-lf:"];

    console.log(
      `The newEntry for path ${path}: ${JSON.stringify(newEntry, 0, 2)}`,
    );

    // 2. update the _meta document
    await oada.delete({
      path: `${path}/_meta/oada-list-lib`,
      data: newEntry,
    });

    await oada.put({
      path: `${path}/_meta/oada-list-lib`,
      data: newEntry,
    });
  } catch (error) {
    console.log(error);
  }
}

function isLink(object) {
  const keys = Object.keys(object);
  return (
    (keys.length === 1 && object._id) ||
    (keys.length === 2 && object._id && object._rev)
  );
}

function isResource(document) {
  return document._id && document._rev && document._type;
}

async function ensureResource(path, data, type) {
  if (!isResource(data)) {
    console.log(`Not a resource: ${path}`);
    const parentPath = path.split("/").slice(0, -1).join("/");
    const contentType = contentTypes[type];

    if (!contentType) {
      console.error(
        `Oh no, could not find contentType for ${type}. Came up here at ${path}`,
      );
      return;
    }

    if (data._meta) delete data._meta;

    try {
      const response = await oada.post({
        path: "/resources",
        contentType,
        data,
      });
      const _id = response.headers["content-location"].slice(1);

      await oada.put({
        path: parentPath,
        contentType: "application/json", // Needs a contentType, but its unimportant for writing links
        data: {
          _id,
        },
      });
    } catch (error) {
      console.log("ensureResource requests failed:", parentPath);
      console.log(error);
    }
  }
}

function dropTrellis(document) {
  delete document._id;
  delete document._rev;
  delete document._type;
  delete document._meta;

  return document;
}

const contentTypes = {
  unidentified: "application/vnd.trellisfw.unidentified",
  "ach-forms": "application/vnd.trellisfw.ach-form.1+json",
  cois: "application/vnd.trellisfw.coi.accord.1+json",
  pfgias: "application/vnd.trellisfw.pfgia.1+json",
  "letters-of-guarantee":
    "application/vnd.trellisfw.letter-of-guarantee.1+json",
  "emergency-contact-information":
    "application/vnd.trellisfw.emergency-contact-information.1+json",
  sars: "application.vnd.trellisfw.sars.1+json",
  "w-9s": "application/vnd.trellisfw.w-9.1+json",
  "nutritional-information":
    "application/vnd.trellisfw.nutritional-information.1+json",
  "allergen-statements": "application/vnd.trellisfw.allergen-statement.1+json",
  "be-ingredient-statements":
    "application/vnd.trellisfw.be-ingredient-statement.1+json",
  "ingredient-statements":
    "application/vnd.trellisfw.ingredient-statement.1+json",
  "ca-prop-65-statements":
    "application/vnd.trellisfw.ca-prop-65-statement.1+json",
  "coo-statements": "application/vnd.trellisfw.coo-statement.1+json",
  "gluten-statements":
    "application/vnd.trellisfw.gluten-claim-statement.1+json",
  "ingredient-breakdowns":
    "application/vnd.trellisfw.ingredient-breakdown.1+json",
  "product-labels": "application/vnd.trellisfw.product-label.1+json",
  "product-specs": "application/vnd.trellisfw.product-spec.1+json",
  sds: "application/vnd.trellisfw.sds.1+json",
  "gmo-statements": "application/vnd.trellisfw.gmo-statement.1+json",
  "natural-statements": "application/vnd.trellisfw.natural-statement.1+json",
  "gfsi-certificates": "application/vnd.trellisfw.gfsi-certificate.1+json",
  "animal-statements": "application/vnd.trellisfw.animal-statement.1+json",
  "srm-statements-audits":
    "application/vnd.trellisfw.srm-statement-audit.1+json",
  "srm-audits": "application/vnd.trellisfw.srm-audit.1+json",
  "srm-statements": "application/vnd.trellisfw.srm-statement.1+json",
  "srm-corrective-actions":
    "application/vnd.trellisfw.srm-corrective-actions.1+json",
  "ecoli-audits": "application/vnd.trellisfw.ecoli-audit.1+json",
  "foreign-material-control-plans":
    "application/vnd.trellisfw.foreign-material-control-plan.1+json",
  "animal-welfare-audits":
    "application/vnd.trellisfw.animal-welfare-audit.1+json",
  "humane-harvest-statements":
    "application/vnd.trellisfw.humane-harvest-statement.1+json",
  "nrp-statements": "application/vnd.trellisfw.nrp-statement.1+json",
  "lot-code-explanations":
    "application/vnd.trellisfw.lot-code-explanation.1+json",
  "aphis-statements": "application/vnd.trellisfw.aphis-statement.1+json",
  "bpa-statements": "application/vnd.trellisfw.bpa-statement.1+json",
  "fsqa-audits": "application/vnd.trellisfw.fsqa-audit.1+json",
  "haccp-plans": "application/vnd.trellisfw.haccp-plan.1+json",
  "copacker-fsqa-questionnaires":
    "application/vnd.trellisfw.copacker-fsqa-questionnaire.1+json",
  "copack-confidentiality-agreement-forms":
    "application/vnd.trellisfw.copack-confidentiality-agreement-form.1+json",
  "tpa-corrective-actions":
    "application/vnd.trellisfw.tpa-corrective-actions.1+json",
  "tpa-food-safety-audits":
    "application/vnd.trellisfw.tpa-food-safety-audit.1+json",
  "tpa-animal-welfare-audits":
    "application/vnd.trellisfw.tpa-animal-welfare-audit.1+json",
  "tpa-animal-welfare-corrective-actions":
    "application/vnd.trellisfw.tpa-animal-welfare-corrective-actions.1+json",
  "w-8s": "application/vnd.trellisfw.w-8.1+json",
  "animal-welfare-corrective-actions":
    "application/vnd.trellisfw.animal-welfare-corrective-actions.1+json",
  "fsqa-certificates": "application/vnd.trellisfw.fsqa-certificate.1+json",
  "signed-vendor-acknowledgement-forms":
    "application/vnd.trellisfw.signed-vendor-acknowledgement-form.1+json",
  "sba-forms": "application/vnd.trellisfw.sba-form.1+json",
  "wire-forms": "application/vnd.trellisfw.wire-form.1+json",
  "ecoli-statements": "application/vnd.trellisfw.ecoli-statement.1+json",
  "ecoli-intervention-statements-audits":
    "application/vnd.trellisfw.ecoli-intervention-statement-audits.1+json",
  "business-licenses": "application/vnd.trellisfw.business-license.1+json",
  "rate-sheets": "application/vnd.trellisfw.rate-sheet.1+json",
  msas: "application/vnd.trellisfw.msa.1+json",
};
