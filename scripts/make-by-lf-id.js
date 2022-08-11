import { connect } from '@oada/client';
import config from '../dist/config.js';
import { getMetadata } from '../dist/cws/index.js';
import { has } from '../dist/utils.js'
import { tree } from '../dist/tree.js'
const { token: tokens, domain } = config.get('oada');
let basePath = `/bookmarks/trellisfw/trading-partners/masterid-index`;

function removeReserved(keys) {
  return keys.filter(key => key.charAt(0) !== '_');
}

async function main() {
  let oada = await connect({
    token: tokens[0],
    domain
  })

  let tps = await oada.get({
    path: basePath
  }).then(r => r.data);

  let tpKeys = removeReserved(Object.keys(tps))

  for await (const tp of tpKeys) {
    let docTypes = await oada.get({
      path: `${basePath}/${tp}/bookmarks/trellisfw/documents`
    }).then(r => r.data)
    .catch(err => {
      if (err.status !== 404) throw err;
      return {};
    })

    let docTypeKeys = removeReserved(Object.keys(docTypes));

    for await (const docType of docTypeKeys) {
      if (docType === "code" || docType === "name") {
        console.log('FOUND bad doctype', `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}`)
        await oada.delete({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}`
        })
        continue;
      }

      let docs = await oada.get({
        path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}`
      }).then(r => r.data)
      .catch(err => {
        if (err.status !== 404) throw err;
        return {};
      })

      let docKeys = removeReserved(Object.keys(docs))

      for await (const docKey of docKeys) {
        //Now, edit the vdoc structure and write the content to the by-lf-id
        console.log('Found:', {path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}`})
        let doc = await oada.get({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}`
        }).then(r => r.data)
        .catch(err => {
          if (err.status !== 404) throw err;
          return {};
        })


        let meta = await oada.get({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta`
        }).then(r => r.data);


        if (meta?.vdoc?.pdf?._id) {
          // Old style vdoc pdf that isn't hash indexed
          console.log('FOUND AN OLD VDOC PDF', `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta`, meta.vdoc.pdf)
          await oada.delete({
            path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta/vdoc`
          })
          let newObj = meta?.vdoc?.pdf;
          delete newObj._id
          await oada.put({
            path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta/vdoc/pdf`,
            data: newObj
          })
        }

        let hashes = removeReserved(Object.keys(meta?.vdoc?.pdf || {}))
        /*
        for await (const hash of hashes) {

          let lfid = meta?.services?.['lf-sync']?.LaserficheEntryID?.[hash];

          if (lfid) {
            let lfmeta= await getMetadata(lfid);
            let currentFields = lfmeta.LaserficheFieldList.reduce(
              (o, f) =>
                has(f, 'Value') && f.Value !== '' ? { ...o, [f.Name]: f.Value } : o,
              {}
            );


            let data = {
              LaserficheEntryID: lfid,
              data: currentFields,
              lastSync: new Date().toISOString()
            }

            console.log('Fix _meta/services/lf-sync', JSON.stringify({
              path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta`,
              data: {
                services: {
                  'lf-sync': {
                    [hash]: data
                  }
                }
              },
              contentType: meta._type
            }, null, 2))

            await oada.put({
              path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta`,
              data: {
                'services': {
                  'lf-sync': {
                    [hash]: data
                  }
                }
              },
              contentType: meta._type
            })

            await oada.put({
              path: `/bookmarks/services/lf-sync/by-lf-id`,
              data: {
                [lfid]: { _id: doc._id }
              }
            })

            console.log('Create by-lf-id', JSON.stringify({
              path: `/bookmarks/services/lf-sync/by-lf-id`,
              data: {
                [lfid]: { _id: doc._id }
              }
            }, null, 2))
          }
        }
        */
        console.log('Delete LaserficheEntryID', JSON.stringify({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta/services/lf-sync/LaserficheEntryID`,
        }, null, 2))
        await oada.delete({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta/services/lf-sync/LaserficheEntryID`,
        })
      }
    }
  }
}
setInterval(()=> console.log('ping'), 3000)
main();