import { buildAllIndexes } from "./index-builder.js";
import { startHttp } from "./http.js";
import { syncRepo } from "./repo.js";

async function main() {
  await syncRepo();
  buildAllIndexes();
  await startHttp();
}

main().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
