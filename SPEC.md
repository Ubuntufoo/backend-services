# Backend Data Model

## Listings

| Field                  | Type        | Reason                                    |
| ---------------------- | ----------- | ----------------------------------------- |
| id                     | uuid        | DB primary key                            |
| listing_id             | text        | Internal ID and SKU base                  |
| sku                    | text        | eBay matching; usually same as listing_id |
| status                 | text        | Main workflow state                       |
| sub_status             | text        | Light UI progress detail                  |
| capture_mode           | text        | Needed for watcher grouping               |
| listing_type           | text        | single or lot                             |
| title                  | text        | Final editable title                      |
| description            | text        | Final editable description                |
| seller_hints           | text        | Important for AI quality                  |
| condition_id           | text        | Needed for eBay publish                   |
| condition_notes        | text        | Useful for cards                          |
| category_id            | text        | Needed for eBay publish                   |
| item_specifics         | jsonb       | Needed for eBay publish                   |
| price                  | numeric     | Needed for eBay publish                   |
| shipping_profile       | text        | Needed for publishing defaults            |
| package_type           | text        | ESE/PWE support                           |
| estimated_weight_oz    | numeric     | Useful for card shipping                  |
| ese_eligible           | boolean     | Useful for card shipping                  |
| handling_days          | integer     | Shipping duration expectancy              |
| merchant_location_key  | text        | eBay offer requirement                    |
| ebay_offer_id          | text        | Publish traceability                      |
| ebay_listing_id        | text        | Publish/order traceability                |
| ebay_listing_url       | text        | Open listing quickly                      |
| ebay_listing_status    | text        | Useful but not essential                  |
| last_error_code        | text        | Debugging                                 |
| last_error_at          | timestamptz | Debugging                                 |
| created_at             | timestamptz | Basic timestamp                           |
| updated_at             | timestamptz | Basic timestamp                           |
| approved_for_export_at | timestamptz | Manual approval timestamp                 |
| exported_at            | timestamptz | Publish timestamp                         |
| sold_at                | timestamptz | Sale timestamp                            |
| image_urls             | jsonb       | R2 public URLs for eBay                   |
| r2_object_keys         | jsonb       | R2 cleanup after sale                     |
| r2_retention_policy    | text        | `r2_retention_days_after_sold`            |
| r2_delete_after        | timestamptz | Date when R2 images may be deleted        |
| r2_deleted_at          | timestamptz | Confirms cleanup happened                 |

## Orders

| Field              | Type        | Reason                            |
| ------------------ | ----------- | --------------------------------- |
| id                 | uuid        | DB primary key                    |
| order_id           | text        | eBay order reference              |
| listing_id         | text        | Match order to listing            |
| sku                | text        | Match order line item to listing  |
| ebay_listing_id    | text        | Traceability                      |
| order_status       | text        | Know paid / unshipped / completed |
| fulfillment_status | text        | Know if it needs shipping         |
| ship_by_date       | timestamptz | Important for 1-day handling      |
| sale_price         | numeric     | Simple sales history              |
| quantity_sold      | integer     | Usually 1                         |
| created_at         | timestamptz | Order record timestamp            |
| updated_at         | timestamptz | Last sync/update                  |

## Jobs

| Field           | Type        | Reason                                                                                    |
| --------------- | ----------- | ----------------------------------------------------------------------------------------- |
| id              | uuid        | DB primary key                                                                            |
| job_type        | text        | `process_images`, `upload_r2`, `generate_ai`, `publish_ebay`, `sync_orders`, `cleanup_r2` |
| listing_id      | text        | Some jobs attach to a listing; order sync may not                                         |
| status          | text        | queued, running, completed, failed                                                        |
| next_run_at     | timestamptz | Scheduled order checks and retries                                                        |
| last_error      | text        | Debugging                                                                                 |
| last_error_code | text        | Debugging                                                                                 |
| last_error_at   | timestamptz | Debugging                                                                                 |
| created_at      | timestamptz | Basic timestamp                                                                           |
| updated_at      | timestamptz | Basic timestamp                                                                           |

## Daily Usage

| Field              | Type    | Reason                        |
| ------------------ | ------- | ----------------------------- |
| gemini_calls_used  | integer | Protect 500/day limit         |
| gemini_daily_limit | integer | Show usage cap in UI          |
| order_sync_count   | integer | Limit to 6/day planned checks |

## App Settings

| Field                         | Type        | Purpose                           | Example                |
| ----------------------------- | ----------- | --------------------------------- | ---------------------- |
| id                            | text        | Single fixed row ID               | default                |
| incoming_folder_path          | text        | Watcher incoming folder           | /image-incoming        |
| processed_folder_path         | text        | Watcher processed folder          | /processed             |
| capture_mode                  | text        | Current capture mode              | lot_3_image            |
| merchant_location_key         | text        | eBay seller location key          | home-office            |
| office_location_name          | text        | Human-readable ship-from location | Home Office            |
| default_payment_policy_id     | text        | eBay payment policy ID            | 123456                 |
| default_fulfillment_policy_id | text        | eBay fulfillment policy ID        | 234567                 |
| default_return_policy_id      | text        | eBay return policy ID             | 345678                 |
| default_shipping_profile      | text        | Local shipping profile label      | eBay Standard Envelope |
| default_package_type          | text        | Default package type              | PWE                    |
| handling_days                 | integer     | Default handling time             | 1                      |
| gemini_daily_limit            | integer     | Daily Gemini cap                  | 500                    |
| max_listings_per_day          | integer     | Personal workflow cap             | 100                    |
| max_order_syncs_per_day       | integer     | Planned order checks per day      | 4                      |
| ebay_marketplace_id           | text        | Default eBay marketplace          | EBAY_US                |
| updated_at                    | timestamptz | Last settings update              | -                      |
| r2_retention_days_after_sold  | integer     | R2 retention window               | 60                     |

## Status Map

| Main Status             | Sub-status               | Purpose                                                         |
| ----------------------- | ------------------------ | --------------------------------------------------------------- |
| record_created          | grouping_images          | Watcher is grouping files from `/image-incoming`                |
| record_created          | preparing_files          | Watcher is renaming files and moving the folder to `/processed` |
| image_processing_queued | waiting_for_image_worker | Image job exists but has not started                            |
| image_processing_queued | processing_images        | Image service is validating and transforming images             |
| images_processed        | waiting_for_r2_upload    | Processed files are ready for R2                                |
| assets_ready            | waiting_for_seller_hints | R2 URLs exist and user should enter seller hints                |
| assets_ready            | ready_to_generate        | Seller hints are saved or user confirmed no hints needed        |
| generating              | ai_call_in_progress      | Gemini request is running                                       |
| needs_review            | review_pending           | User needs to review AI-generated listing                       |
| approved_for_export     | publish_queued           | Listing is approved and waiting for eBay publish                |
| approved_for_export     | publishing_to_ebay       | eBay inventory item, offer, and publish steps are running       |
| listed                  | active_live              | eBay confirms listing is active/live                            |
| sold                    | awaiting_packaging       | Sold item needs to be packed                                    |
| sold                    | shipped                  | Item has been shipped                                           |
