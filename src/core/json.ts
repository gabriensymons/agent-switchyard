export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end < start) {
    throw new Error("Command output did not contain a JSON object");
  }

  return JSON.parse(text.slice(start, end + 1)) as unknown;
}
