import { db } from "./index";
import { authorizedUsers } from "./schema";

// Add your authorized email addresses here
const AUTHORIZED_EMAILS = [
  "your-email@example.com",
  // Add more emails as needed
];

async function seed() {
  console.log("Seeding database...");

  await db.insert(authorizedUsers).values(
    AUTHORIZED_EMAILS.map(email => ({ email }))
  ).onConflictDoNothing();

  console.log("Database seeded successfully!");
  console.log(`Added ${AUTHORIZED_EMAILS.length} authorized user(s)`);
}

seed().catch(console.error);
