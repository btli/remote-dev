import { db } from "./index";
import { authorizedUsers } from "./schema";

async function seed() {
  console.log("Seeding database...");

  await db.insert(authorizedUsers).values([
    { email: "admin@localhost" },
  ]).onConflictDoNothing();

  console.log("Database seeded successfully!");
}

seed().catch(console.error);
