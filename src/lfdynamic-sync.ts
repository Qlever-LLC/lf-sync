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

import { config } from './config.js';

import { type JsonObject, type OADAClient, connect } from '@oada/client';
import debug from 'debug';
import { doJob } from '@oada/client/jobs';
import sql from 'mssql';

const info = debug('lf-sync--lfdynamic:info');
const error = debug('lf-sync--lfdynamic:error');

const { domain, token } = config.get('oada');
const { database, password, port, server, user } = config.get('lfdynamic');
// Const VENDOR_SHEET = 'LFA1';
// const NAME_COL = 'Name 1';
const PRODUCTION = true;
const ENTITY_NAME_LENGTH = 51;

let sqlConfig = {
  server,
  database,
  user,
  password,
  port,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

if (PRODUCTION) {
  sqlConfig = {
    server,
    database,
    user,
    port,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };
}

async function main() {
  try {
    await sql.connect(sqlConfig);

    // Get some table info
    // const qresult = await sql.query`select * from SYSOBJECTS WHERE xtype = 'U'`;
    // const rresult = await sql.query`select * from LFDynamic.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SFI_Entities'`;
    // const rresult = await sql.query`ALTER TABLE [dbo].[SFI_Entities] ADD trellis_masterid VARCHAR(255) NOT NULL`;
    // Our user permissions
    // const rresult = await sql.query`select * FROM sys.fn_my_permissions(NULL, 'SERVER')`;
    // All possible permissions
    // const rresult = await sql.query`select * FROM sys.fn_builtin_permissions(DEFAULT)`;
    // console.log(JSON.stringify(rresult, null, 2));
    // let res = await sql.query`select * from SFI_Entities`;
    // const r = await sql.query`select COL_LENGTH('dbo.SFI_Entities', 'Entity Name') AS Result`
    // console.log(r);
    const name = 'Reynolds Presto Products, Inc. dba Presto Products Company';

    try {
      const result =
        await sql.query`DECLARE @NAME NVARCHAR(100) SET @NAME=(${sanitize(name)}) INSERT INTO SFI_Entities ("Entity Name") VALUES (@NAME)`;
      const res =
        await sql.query`select * from SFI_Entities WHERE ("Entity Name")=STRING_ESCAPE(${name})`;
      console.log(JSON.stringify({ res, result }, null, 2));
      //      Const result = await sql.query`INSERT INTO SFI_Entities ("Entity Name") VALUES (${name})`;
      console.log(result);
    } catch (error_) {
      console.log(error_);
    }
    // Let res = await sql.query`select * from SFI_Entities WHERE ("Entity Name")=(${name})`;

    /*
    // Get the current table content
    const { recordset: qresult } = await sql.query`select * from SFI_Entities`;
    // Get the trading partners expand index
    const { oada, trellisList } = await fetchTradingPartners();
    await handleEntities(oada, trellisList);
    await pruneEntities(trellisList, qresult);
    */
  } catch (error_) {
    error(error_);
  }
  //  Process.exit();
}

/*
Async function addRemove(list: Array<sqlEntry>, name: string) {
  let exists = list.map(v => v["Entity Name"]).includes(name)
  let item = list.filter(v => v["Entity Name"] === name)
  let theItem = item[0];
  if (exists && theItem) {
    await removeEntity(theItem.rowguid);
  } else {
    await addEntity(name)
  }
  }

*/
async function removeEntity(rowguid: string) {
  return sql.query`DELETE FROM SFI_Entities WHERE rowguid=${rowguid}`;
}

export async function addEntity(name: string) {
  info(`adding ${name}`);
  try {
    return await sql.query`INSERT INTO SFI_Entities ("Entity Name") VALUES (${name})`;
    // Await sql.query`INSERT INTO SFI_Entities ("Entity Name", "masterid") VALUES (${name}, ${masterid})`;
  } catch (error_: unknown) {
    error('ERRORED ON THIS ONE', name);
    error(error_);
    throw error_;
  }
}

export async function fetchTradingPartners() {
  const oada = await connect({
    domain,
    token: token as unknown as string,
  });

  const { data: tps } = await oada.get({
    path: `/bookmarks/trellisfw/trading-partners/_meta/indexings/expand-index`,
  });
  return {
    trellisList: Object.values(tps as JsonObject) as unknown as TrellisEntry[],
    oada,
  };
}

async function removeDupeEntities(records: SqlEntry[]) {
  const record = records.shift();
  for await (const rec of records) {
    await removeEntity(rec.rowguid);
  }

  return record;
}

// Remove entries if no trading-partners mention their rowguid
export async function pruneEntities(
  trellis: TrellisEntry[],
  sqlList: SqlEntry[],
) {
  for await (const ent of sqlList) {
    const lfdynamic = `lfdynamic:${ent.rowguid}`;
    const foundTp = trellis.find((tp) => tp.externalIds.includes(lfdynamic));
    info(
      `pruneEntities found no matches for ${ent['Entity Name']} [${ent.rowguid}]`,
    );
    if (!foundTp) {
      await removeEntity(ent.rowguid);
    }
  }
}

// Remove special characters; truncate to allowable nvarchar(100) size
function sanitize(value: string) {
  return value
    .replaceAll(/[%[\]^_]/g, '')
    .slice(0, Math.max(0, ENTITY_NAME_LENGTH));
}

export async function handleEntities(
  oada: OADAClient,
  trellis: TrellisEntry[],
) {
  // SqlList: SqlEntry[]) {
  // Find if an existing row exists
  for await (const tp of trellis) {
    if (!tp.externalIds) continue;
    if (!tp.externalIds.some((id: string) => id.startsWith('lfdynamic'))) {
      let res =
        await sql.query`select * from SFI_Entities WHERE ("Entity Name")=(${sanitize(tp.name)})`;
      let record;
      record =
        res?.recordset.length > 1
          ? await removeDupeEntities(Array.from(res.recordset))
          : res?.recordset?.[0];
      if (!record) {
        console.log('No result for TP', tp.name);
        // Does not exist. Create it
        try {
          await sql.query`INSERT INTO SFI_Entities ("Entity Name") VALUES (${tp.name})`;
          res =
            await sql.query`select * from SFI_Entities WHERE ("Entity Name")=(${tp.name})`;
          record = res?.recordset?.[0];
        } catch (error_: any) {
          error(
            `Was an error updating a LFDynamic entity to match trading partner ${tp.name} [${tp.masterid}]`,
          );
          error(error_);
          if (
            error_.message.includes('String or binary data would be truncated')
          ) {
          }

          continue;
        }
      }

      const { rowguid } = record;
      if (!record || !rowguid) {
        console.log('Missing rowguid');
        continue;
      }

      const lfdynamic = `lfdynamic:${rowguid}`;
      await doJob(oada, {
        type: 'trading-partners-update',
        service: 'trellis-data-manager',
        config: {
          element: {
            masterid: tp.masterid,
            externalIds: Array.from(new Set([...tp.externalIds, lfdynamic])),
          },
        },
      });
    }
  }
  /* Old code
  const list = new Set(sqlList.map((index) => index.rowguid));
  await Promise.all(sqlList.map(async (index) => removeEntity(index.rowguid)));
  return Promise.all(
    trellis.map(async (item) => {
      // TODO: Probably change this test after we add trellisId or something to the sql table entries
      if (!list.has(item.masterid) && item.masterid !== undefined) {
        await addEntity(item.name);
      }
    })
  );
  */
}

// No longer using this. Was for syncing the SAP spreadsheet export
/*
function grabVendors() {
  const wb = xlsx.readFile('./SAPDATA.xlsx');
  const sheet = wb.Sheets[VENDOR_SHEET];
  // @ts-expect-error thing
  let rows: SAPVendor[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  // Eliminate Blocked vendors
  rows = rows.filter((r) => !r[NAME_COL].startsWith('BLK'));
  // Handle duplicates...
  // rows = Array.from(new Map(rows.map((m) => [m[NAME_COL], m])).values());
  return rows.map((r) => mapVendor(r));
}

function mapVendor(vendor: SAPVendor) {
  return {
    externalIds: [
      `sap:${vendor.Vendor}`,
      `ein:${vendor['Tax Number 1']}`,
      `ein:${vendor['Tax Number 2']}`,
    ].filter(Boolean),
    city: vendor.City,
    state: vendor.Region,
    country: vendor.Country,
    name: vendor['Name 1'],
    phone: vendor['Telephone 1'],
    address: vendor.Street,
  };
}
*/
interface SqlEntry {
  'rowguid': string;
  'Entity Name': string;
}

interface TrellisEntry {
  name: string;
  masterid: string;
  externalIds: string[];
}

export interface SAPVendor {
  'Account group': string;
  'Central deletion flag': string;
  'City': string;
  'Country': string;
  'Name 1': string;
  'P.O. Box Postal Code': string;
  'PO Box': string;
  'Postal Code': string;
  'Region': string;
  'Street': string;
  'Tax Number 1': string;
  'Tax Number 2': string;
  'Telephone 1': string;
  'Telephone 2': string;
  'Vendor': string;
}

await main();
// Const rows = grabVendors();
// console.log(rows);
