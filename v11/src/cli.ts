import { runMigration } from "./index.js";

runMigration().catch((err) => {
	console.error(err);
	process.exit(1);
});
