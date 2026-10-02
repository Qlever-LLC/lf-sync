# Laserfiche Sync On ARO

This is a staged deployment: it builds the rc.11 service image and runs one
replica in no-write projection mode. Source event consumers, delivery state,
and dashboard reads are active, while `LF_SYNC_WRITE_MODE=disabled` prevents
Laserfiche mutations.

Create `lf-sync-cws` from an approved secret store, do not apply
`secret.example.yaml`, then build with:

```sh
oc apply -k deploy/aro
oc start-build laserfiche-sync --from-dir=. --follow
```

Before enabling writes, reconcile the service contract, provision Postgres and
the declared Trellis bindings, validate no-write event processing, and obtain
explicit approval for a bounded CWS canary.
