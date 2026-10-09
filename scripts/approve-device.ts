/**
 * Local test helper for scripts/device-flow.sh: approve a user code as <email>,
 * creating that user if needed. Refuses to run against a non-file database.
 *   tsx scripts/approve-device.ts ABCD-EFGH tester@example.com
 */
import "./env";
import { databaseUrl } from "../lib/db";
import { approveDevice, normalizeUserCode } from "../lib/auth/deviceLink";
import { createUser, findUserByEmail } from "../lib/auth/users";

async function main() {
  if (!databaseUrl().startsWith("file:")) throw new Error("approve-device only runs against the local database");
  const [codeArg, email = "device-flow@example.com"] = process.argv.slice(2);
  const code = normalizeUserCode(codeArg);
  if (!code) throw new Error(`bad user code: ${codeArg}`);
  const user =
    (await findUserByEmail(email)) ??
    (await createUser({ email, password: "device-flow-test", displayName: "Device Flow Test", locale: "en" }));
  const result = await approveDevice(code, user.id);
  console.log(result);
  if (result !== "approved") process.exit(1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
