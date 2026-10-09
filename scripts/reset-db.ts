import { rmSync } from "node:fs";
import { databaseUrl, isLocalDatabase } from "../lib/db.ts";

const url = databaseUrl();
if (!isLocalDatabase(url)) {
  console.error(`Refusing to reset a remote database (${url}).`);
  process.exit(1);
}
const path = url.slice("file:".length);
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(path + suffix, { force: true });
}
console.log(`removed ${path}`);
