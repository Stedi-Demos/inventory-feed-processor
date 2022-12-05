import fetch from "node-fetch";
import consumers from 'stream/consumers';
import { Readable } from "stream";
import { serializeError } from "serialize-error";

import { DeleteObjectCommand, GetObjectCommand } from "@stedi/sdk-client-buckets";

import {
  failedExecution,
  functionName,
  generateExecutionId,
  markExecutionAsSuccessful,
  recordNewExecution
} from "../../../lib/execution.js";
import { Convert, Record as BucketNotificationRecord } from "../../../lib/types/BucketNotificationEvent.js";
import { bucketClient } from "../../../lib/buckets.js";
import { FilteredKey, GroupedEventKeys, KeyToProcess, ProcessingResults } from "./types.js";
import { requiredEnvVar } from "../../../lib/environment.js";
import { trackProgress } from "../../../lib/progressTracking.js";
import { convertCsvToJson, defaultCsvToJsonConversionOptions } from "../../../lib/converter";

// Buckets client is shared across handler and execution tracking logic
const bucketsClient = bucketClient();

export const handler = async (event: any): Promise<Record<string, any>> => {
  const executionId = generateExecutionId(event);
  await trackProgress(`starting ${functionName()}`, { input: event, executionId });

  try {
    await recordNewExecution(executionId, event);
    const bucketNotificationEvent = Convert.toBucketNotificationEvent(JSON.stringify(event));

    // Fail fast if required env vars are missing
    const destinationWebhookUrl = requiredEnvVar("DESTINATION_WEBHOOK_URL");

    // Extract the object key from each record in the notification event, and split the keys into two groups:
    // - filteredKeys:  keys that won't be processed (notifications for folders or objects not in an `inventory` directory)
    // - keysToProcess: keys for objects in an `inventory` directory, which will be processed by the handler
    const groupedEventKeys = groupEventKeys(bucketNotificationEvent.Records);
    await trackProgress("grouped event keys", groupedEventKeys);

    // empty structure to hold the results of each key that is processed
    const results: ProcessingResults = {
      filteredKeys: groupedEventKeys.filteredKeys,
      processingErrors: [],
      processedKeys: [],
    }

    // Iterate through each key that represents an object within an `inventory` directory
    for await (const keyToProcess of groupedEventKeys.keysToProcess) {
      const senderId = extractShopIdFromKey(keyToProcess.key);
      const getObjectResponse = await bucketsClient.send(new GetObjectCommand(keyToProcess));
      const fileContents = await consumers.text(getObjectResponse.body as Readable);

      try {
        // Demo conversion includes the following transformations of the headers from the input csv:
        //  - transformed to lower case
        //  - substrings of headers comprised of spaces and forward slashes replaced with an underscore
        // Additional customization can be done to meet the needs of your inventory processing!
        const inventoryJson = convertCsvToJson(fileContents, {
          ...defaultCsvToJsonConversionOptions,
          transformHeader(header: string): string {
            return header.toLowerCase().replace(/[ \/]+/g, "_");
          },
        });

        await trackProgress("converted inventory JSON", { senderId, inventoryJson });

        await fetch(
          destinationWebhookUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ [senderId]: inventoryJson }),
          }
        );

        // TODO: optionally send inventory feed to stash

        // Delete the processed file (could also archive in a `processed` directory or in another bucket if desired)
        await bucketsClient.send(new DeleteObjectCommand(keyToProcess));
        results.processedKeys.push(keyToProcess.key);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(`unknown error: ${serializeError(e)}`);
        await trackProgress("error processing document", { key: keyToProcess.key, error: serializeError(error) });
        results.processingErrors.push({
          key: keyToProcess.key,
          error,
        });
      }
    }

    // if any keys failed to process successfully, mark the execution as failed to enable triage
    const errorCount = results.processingErrors.length;
    if (errorCount > 0) {
      const keyCount = groupedEventKeys.keysToProcess.length;
      const keyCountMessage = `${keyCount} key${keyCount > 1 ? "s" : ""}`;
      const errorCountMessage = `${errorCount} error${errorCount > 1 ? "s" : ""}`;
      const message = `encountered ${errorCountMessage} while attempting to process ${keyCountMessage}`;
      return failedExecution(executionId, new Error(message));
    }

    await markExecutionAsSuccessful(executionId);
    await trackProgress("results", results);

    return results;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(`unknown error: ${JSON.stringify(e)}`);
    await trackProgress("handler error", { error: serializeError(error) });

    // Note, if an infinite Function execution loop is detected by `executionsBucketClient()`
    // the failed execution will not be uploaded to the executions bucket
    return failedExecution(executionId, error);
  }
};

const groupEventKeys = (records: BucketNotificationRecord[]): GroupedEventKeys => {
  const filteredKeys: FilteredKey[] = [];
  const keysToProcess = records.reduce((collectedKeys: KeyToProcess[], record) => {
    const eventKey = record.s3.object.key;

    if (eventKey.endsWith("/")) {
      filteredKeys.push({
        key: eventKey,
        reason: "key represents a folder",
      });
      return collectedKeys;
    }
    const splitKey = eventKey.split("/");
    if (splitKey.length < 2 || splitKey[splitKey.length - 2] !== "inventory") {
      filteredKeys.push({
        key: eventKey,
        reason: "key does not match an item in an `inventory` directory",
      });
      return collectedKeys;
    }

    return collectedKeys.concat({
      bucketName: record.s3.bucket.name,
      key: decodeObjectKey(eventKey),
    });
  }, []);

  return {
    filteredKeys,
    keysToProcess,
  }
};

// Object key components are URI-encoded (with `+` used for encoding spaces)
const decodeObjectKey = (objectKey: string): string =>
  decodeURIComponent(objectKey.replace(/\+/g, " "));

const extractShopIdFromKey = (objectKey: string): string => {
  const keyParts = objectKey.split(`/`);

  if (keyParts.length !== 4) {
    // inbound keys are expected to be in the format: `trading_partners/${senderId}/inventory/${filename}.csv`
    throw new Error("unable to extract sender ID from object key");
  }

  return keyParts[1];
};