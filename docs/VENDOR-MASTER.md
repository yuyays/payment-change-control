# Vendor master revalidation

The worker reads the trusted `VENDOR_MASTER` KV binding when the cooling-off
alarm fires. Each key is a vendor ID, and its JSON value is a domain `Vendor`
(`id`, `name`, `registeredDomain`, `phoneOnFile`, `bankAccount` with `bankName`
and `iban`, and nullable `lastBankChangeAt`). Only trusted master-data tooling
should write this namespace. Intake and email extraction never write it.

Before deploying, create a KV namespace and replace the placeholder namespace ID
in `apps/worker/wrangler.jsonc`. Populate it from the authoritative master-data
system. For local development, put the demo vendor into a JSON file and run:

```sh
cd apps/worker
pnpm exec wrangler kv key put v-acme --binding VENDOR_MASTER --local --path /path/to/vendor.json
```

Use the same persistence directory as `wrangler dev` (supply `--persist-to` to
both commands if customized). `scripts/durability.sh` provisions its own fixture.
Existing demo intake payloads still supply the snapshot, but the corresponding
master entry must now exist before the request can leave cooling-off.

The alarm compares the intake snapshot with the fetched record using exact
values. A bank name, IBAN, registered domain or phone change sets status to
`invalidated`, stores `invalidationReason: "vendor.changed_mid_flow"`, and records
`vendor.revalidated` plus `vendor.changed_mid_flow` events. The payload lists
changed field names, not account/phone values. Non-critical metadata changes do
not invalidate. An unchanged record produces `vendor.revalidated` and the usual
`cooling_off.elapsed` event, then `ready_for_review`.

Missing, malformed, mismatched-ID or unavailable master data produces
`vendor.revalidation_failed`; the request remains pending and the alarm is
rescheduled for one minute later. Approval requires `ready_for_review`, not merely
an elapsed clock. Invalidated requests cannot be approved or revived by duplicate
alarms; start a new request after reconciling the change. The original snapshot
and evaluation remain untouched for replay.

KV is eventually consistent: this check uses the latest value visible to the
worker, not a transactional read of an external master database. Master-data
synchronization must account for propagation delay; deployments requiring strict
read-after-write consistency should replace this adapter with a strongly
consistent master service.
