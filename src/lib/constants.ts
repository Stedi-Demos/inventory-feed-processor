import dotenv from "dotenv";

import { requiredEnvVar } from "./environment.js";

dotenv.config({ override: true });

export const INVENTORY_DATA_STASH_KEYSPACE_NAME = "inventory-data";

export const DEFAULT_SDK_CLIENT_PROPS = {
  apiKey: requiredEnvVar("STEDI_API_KEY"),
  region: "us",
};
