# Stedi inventory feed demo

This repo contains an end-to-end demo for reading inbound inventory feeds and sending the data to an API destination.

The main orchestration point of this demo is a Stedi function called [`inventory-feed-processor`](src/functions/inventory/feed-processor/handler.ts), which is written in [TypeScript](https://www.typescriptlang.org/). For this workload, the function is invoked when new items are uploaded to the [SFTP](https://www.stedi.com/docs/sftp)-enabled [bucket](https://www.stedi.com/docs/bucket). The function processes inventory feed CSV files that are uploaded to a directory that matches the pattern: `trading_partners/${senderId}/inventory` within the bucket, converting the CSV to a JSON payload that is then sent to an external webhook.

As the illustration below shows, the `inventory-feed-processor` function performs several steps:

1. Accepts a bucket notification event that is generated when files are written to the bucket

1. Retrieves the contents of the uploaded file from the bucket

1. Converts the CSV to JSON

1. Calls an external webhook with the JSON output from the mapping operation as the payload

1. The function finally deletes the uploaded file from the bucket after it has been processed

<!-- TODO: add diagram:
![inventory-feed-processor function flow](./assets/inventory-feed.svg)
-->

## Prerequisites

1. [Node.js](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) _(`npm` version must be 7.x or greater)_

1. A [Stedi account](https://www.stedi.com/docs/getting-started/accounts-and-members)

1. A Stedi API key -- if you don't already have one, you can generate an [API Key here](https://www.stedi.com/app/settings/api-keys).

## Setup & Deployment

1. Clone this repo and install the necessary dependencies: 

   ```bash
   git clone https://github.com/Stedi-Demos/inventory-feed-processor.git
   cd inventory-feed-processor 
   npm ci
   ```
   
1. Go to [webhook.site](https://webhook.site/) and copy the unique URL. The demo will send output to this webhook.

1. This project uses `dotenv` to manage the environmental variables required. You must create a `.env` file in the root directory of this repo and add two required environment variables:
   * `STEDI_API_KEY`: Your Stedi API Key - used to deploy the function and internally to interact with product APIs. If you don't already have one, you can generate an [API Key here](https://www.stedi.com/app/settings/api-keys). 
   * `DESTINATION_WEBHOOK_URL`: the unique URL copied from [webhook.site](https://webhook.site/) in the previous step.
   * `PROGRESS_TRACKING_WEBHOOK_URL` [_optional but recommended_]: the unique URL copied from [webhook.site](https://webhook.site/) in the previous step -- including this environment variable enables additional progress tracking and improves observability of the function executions. For more details on the progress tracking, [see below](#additional-progress-tracking).

   Example `.env` file:

    ```
    STEDI_API_KEY=<REPLACE_ME>
    DESTINATION_WEBHOOK_URL=https://webhook.site/<YOUR_UNIQUE_ID>
    PROGRESS_TRACKING_WEBHOOK_URL=https://webhook.site/<YOUR_UNIQUE_ID>
    ```

1. Configure the buckets (one for SFTP access and one for tracking function executions):

   ```bash
   npm run configure-buckets
   ```

   For each bucket, an environment variable entry will automatically be added to the `.env` file. The output of the script will include a list of the environment variables that have been added:

   ```bash
   Updated .env file with 2 bucket entries:

   SFTP_BUCKET_NAME=4c22f54a-9ecf-41c8-b404-6a1f20674953-sftp
   EXECUTIONS_BUCKET_NAME=4c22f54a-9ecf-41c8-b404-6a1f20674953-executions
   ```
   
1. Confirm that your `.env` file contains the necessary environment variables: 
   - `STEDI_API_KEY` 
   - `DESTINATION_WEBHOOK_URL`
   - `SFTP_BUCKET_NAME`
   - `EXECUTIONS_BUCKET_NAME`

   It should look something like the following:

   ```
   STEDI_API_KEY=<YOUR_STEDI_API_KEY>
   DESTINATION_WEBHOOK_URL=https://webhook.site/<YOUR_UNIQUE_ID>
   PROGRESS_TRACKING_WEBHOOK_URL=https://webhook.site/<YOUR_UNIQUE_ID>
   SFTP_BUCKET_NAME=4c22f54a-9ecf-41c8-b404-6a1f20674953-sftp
   EXECUTIONS_BUCKET_NAME=4c22f54a-9ecf-41c8-b404-6a1f20674953-executions
   ```

1. This repo includes a basic deployment script to bundle and deploy the `inventory-feed-processor` function to Stedi. To deploy the function:

   ```bash
   npm run deploy
   ```

   This should produce the following output:

   ```
   > stedi-inventory-feed-processor@1.0.0 deploy
   > ts-node ./src/setup/deploy.ts

   Deploying inventory-feed-processor
   Done inventory-feed-processor
   Deploy completed at: 11/10/2022, 06:48:43 PM
   ```
   
1. Enable bucket notifications for the SFTP bucket to invoke the `inventory-feed-processor` function when files are written to the bucket

   ```bash
   npm run enable-notifications
   ```
   
## Invoking the function

Once deployed, the function will be invoked when files are written to the SFTP bucket.

1. Using the [Buckets UI](https://www.stedi.com/app/buckets) navigate to the `inventory` directory for your trading partner: `<SFTP_BUCKET_NAME>/trading_partners/shop_1/inventory`

1. Upload an inventory feed CSV file to this directory. If you don't have an inventory feed CSV available, there is a sample feed that you can use: [feed.csv](/inventory-feeds/feed.csv).  (_note_: if you upload the document to the root directory `/`, it will be intentionally ignored by the `inventory-feed-processor` function)

1. Look for the output of the function wherever you created your test webhook! The function sends the inventory feed in JSON format

    JSON Mapping output:
    ```json
    {
      "orderAcknowledgements": [
        {
          "orderAcknowledgementDetails": {
            "internalOrderNumber": "ACME-4567",
            "orderNumber": "365465413",
            "orderDate": "2022-09-14",
            "orderAckDate": "2022-09-13"
          },
          "seller": {
            "name": "Marvin Acme",
            "address": {
              "street1": "123 Main Street",
              "city": "Fairfield",
              "state": "NJ",
              "zip": "07004",
              "country": "US"
            }
          },
          "shipTo": {
            "customerId": "DROPSHIP CUSTOMER",
            "name": "Wile E Coyote",
            "address": {
              "street1": "111 Canyon Court",
              "city": "Phoenix",
              "state": "AZ",
              "zip": "85001",
              "country": "US"
            }
          },
          "items": [
            {
              "id": "item-1",
              "quantity": 8,
              "unitCode": "EA",
              "price": 400,
              "vendorPartNumber": "VND1234567",
              "sku": "ACM/8900-400"
            },
            {
              "id": "item-2",
              "quantity": 4,
              "unitCode": "EA",
              "price": 125,
              "vendorPartNumber": "VND000111222",
              "sku": "ACM/1100-001"
            }
          ]
        }
      ] 
    }
    ```

1. [Optional -- Bonus / Extra Credit] Try invoking the workflow via SFTP!
   1. Provision an SFTP user, by visiting the [SFTP Web UI](https://www.stedi.com/app/sftp), be sure to set its `Home directory` to `/trading_partners/shop_1` and record the password (it will not be shown again)
   1. Using the SFTP client of your choice (the `sftp` command line client and [Cyberduck](https://cyberduck.io/) are popular options) connect to the SFTP service using the credentials for the SFTP user that you created.
   1. Navigate to the `/inventory` subdirectory
   1. Upload an inventory feed CSV file to the `/inventory` directory via SFTP
   1. view the results at your webhook destination!

## Function execution tracking

The `inventory-feed-processor` function uses the bucket referenced by the `EXECUTIONS_BUCKET_NAME` environment variable to track details about each invocation of the function.

1. At the beginning of each invocation, an `executionId` is generated. The `executionId` is a hash of the function name and the input payload. This allows subsequent invocations of the function with the same payload to be processed as retries.
 
1. The Bucket Notification event input to the function is written to the executions bucket in the following location:

   ```bash
   functions/inventory-feed-processor/${executionId}/input.json
   ```
1. If any failures are encountered during the execution of the function, the details of the failure are written to the following location:

   ```bash
   functions/inventory-feed-processor/${executionId}/failure.json 
   ```
   
1. Upon successful invocation of the function (either on the initial invocation, or on a subsequent retry), the `input.json` as well as the `failure.json` from previous failed invocations (if present) are deleted. Therefore, any items present in the `executions` bucket represent in-progress executions, or previously failed invocations (with details about the failure).

## Additional progress tracking

Additional progress tracking can be enabled by including the `PROGRESS_TRACKING_WEBHOOK_URL` environment variable in your `.env` file. The additional progress tracking provides more visibility into the process of translating the input X12 EDI document into the custom JSON output shape. The `read-inbound-edi` function records additional details as it processes documents, and it sends this output to the destination webhook URL. You can change the destination for the additional progress tracking by changing the corresponding environment variable (or remove the environment variable completely to disable this additional tracking):

  ```
  PROGRESS_TRACKING_WEBHOOK_URL=https://webhook.site/<YOUR_UNIQUE_ID>
  ```

Note: after updating (or removing) this environment variable, you will need to also update (or remove) the environment variable from the deployed `read-inbound-edi` function. You can do this via the [Functions UI](https://www.stedi.com/terminal/functions/read-inbound-edi), or by re-running `npm run deploy`.
