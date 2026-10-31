import { SnapshotTarget, verify } from "./migration";

// Isolated CLI readback worker, not an authenticated production Domain Service.
const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error("snapshot_path_required");
const snapshot = await new SnapshotTarget(snapshotPath).read();
if (!snapshot) throw new Error("snapshot_missing");
process.stdout.write(JSON.stringify(verify(snapshot)) + "\n");
