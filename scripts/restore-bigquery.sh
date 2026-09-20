#!/usr/bin/env bash
#
# Recreate the BigQuery data source that was removed in PR #2 (merge 42dee78).
#
# This is a RECREATION script, not a restore. There was nothing to back up:
# every dataset was empty when BigQuery was removed — `ads_data` held 0 tables
# and had never held any, and the 40 most recent query jobs had all failed with
# "Not found: Table datarocks-prod:ads_data.user_ads_stats". See
# docs/bigquery-disabled.md for the evidence.
#
# Running this restores the INFRASTRUCTURE. The application code has to come
# back separately — see step 0.
#
# Usage:  ./scripts/restore-bigquery.sh [PROJECT_ID]
# Default project: datarocks-prod
set -euo pipefail

PROJECT="${1:-datarocks-prod}"
DATASET="ads_data"
TABLE="user_ads_stats"
# ── LOCATION IS LOAD-BEARING ────────────────────────────────────────────────
# The original ads_data lived in the EU multi-region. Every failing query
# reported "was not found in location EU". A dataset created in the US default
# would be a DIFFERENT dataset that the old queries could never reach, and
# BigQuery does not move datasets between locations.
LOCATION="EU"
SA_NAME="datarocks-bq"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "==> project=${PROJECT} dataset=${DATASET} table=${TABLE} location=${LOCATION}"

echo "==> enabling the BigQuery APIs"
gcloud services enable bigquery.googleapis.com bigquerystorage.googleapis.com --project="${PROJECT}"

echo "==> dataset"
bq --project_id="${PROJECT}" --location="${LOCATION}" mk --dataset \
  --description="Google Ads rows written by /api/sync" "${DATASET}" 2>/dev/null \
  || echo "    (already exists)"

# ── SCHEMA ──────────────────────────────────────────────────────────────────
# Taken from writeAdsWideRows() in the deleted src/lib/bigquery.ts — the exact
# keys it put in each insertAll row.
#
# `date` is STRING, deliberately, and this is the second trap. The read path
# bound every query parameter as {"type":"STRING"} and asked
# `WHERE date BETWEEN @date_from AND @date_to`. Against a DATE column BigQuery
# answers "No matching signature for operator BETWEEN", so creating this column
# with the obvious DATE type breaks reads in a way that looks unrelated. Change
# it only if you also change the parameter binding.
echo "==> table"
bq --project_id="${PROJECT}" mk --table "${DATASET}.${TABLE}" \
  user_id:STRING,date:STRING,report_type:STRING,campaign:STRING,\
advertising_channel_type:STRING,ad_group:STRING,keyword:STRING,\
match_type:STRING,device:STRING,network:STRING,search_term:STRING,\
audience:STRING,country:STRING,region:STRING,hour:INTEGER,\
day_of_week:STRING,impressions:INTEGER,clicks:INTEGER,spend:FLOAT,\
conversions:FLOAT,conversion_value:FLOAT,synced_at:TIMESTAMP 2>/dev/null \
  || echo "    (already exists)"

echo "==> service account"
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="DataRocks BigQuery" --project="${PROJECT}" 2>/dev/null \
  || echo "    (already exists)"
for ROLE in roles/bigquery.dataEditor roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "${PROJECT}" \
    --member="serviceAccount:${SA}" --role="${ROLE}" --quiet >/dev/null
  echo "    granted ${ROLE}"
done

cat <<EOF

==> DONE — infrastructure only. Three things remain:

0. Restore the code. It is not in the working tree:
       git revert -m 1 42dee78     # "remove the BigQuery source entirely (#2)"
   That brings back lib/bigquery.ts, lib/bqSource.ts, lib/google-ads-sync.ts,
   /api/sync, /api/bq, /api/bq-data, /api/auth/google-ads/* and
   resolveSourceFor() in lib/dataSource.ts.

1. Credentials. The organisation enforces
   iam.disableServiceAccountKeyCreation, so you CANNOT create a JSON key in
   ${PROJECT}. The old key existed only because datarocks-prod-494700 carried a
   project-level exemption, and that project is being shut down. Use workload
   identity federation instead — src/lib/gemini.ts already does exactly this
   and is the model to copy.

2. Environment variables (Vercel, Production + Preview):
       BQ_PROJECT_ID=${PROJECT}
       BQ_DATASET_ID=${DATASET}
       BQ_TABLE=${TABLE}
       BQ_SERVICE_ACCOUNT_JSON=<only if you have a key; see 1>

3. Build the UI that never existed. This is the real work, and the reason
   BigQuery never ingested a row: nothing in the app links to
   /api/auth/google-ads, nothing calls /api/sync, and resolveSourceFor()
   returned "windsor" for any account with a windsorAccountId BEFORE it tested
   for BigQuery — which is every account, because the Windsor co-user flow is
   the only connect path Data Sources offers. Recreating the table and the env
   vars changes nothing on its own.
EOF
