// Runs a job end to end: publish(), then store the entries only if the run was published.
import { writeEntries } from "./content-store";
import { publish } from "./publish";
import type { PublishRequest, PublishResult } from "./types";

export async function runJob(request: PublishRequest & { contentDir: string }): Promise<PublishResult> {
  const result = await publish(request);
  if (result.status === "published") await writeEntries(request.contentDir, result.entries);
  return result;
}
