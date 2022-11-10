import papaparse from "papaparse";

export const defaultCsvToJsonConversionOptions: papaparse.ParseConfig = {
  header: true,
  skipEmptyLines: true,
  quoteChar: '"',
};

export const convertCsvToJson = <T>(inputCsv: string, parseConfig?: papaparse.ParseConfig): T[] => {
  const config = parseConfig || defaultCsvToJsonConversionOptions;
  const result = papaparse.parse(inputCsv, config);

  if (result.errors.length > 0) {
    throw new Error(`error${result.errors.length > 1 ? "s" : ""} encountered converting CSV to JSON: ${result.errors}`);
  }

  return result.data;
};
