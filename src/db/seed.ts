import { db } from "./index";
import { authorizedUsers } from "./schema";

// Get authorized emails from environment variable (comma-separated)
// Example: AUTHORIZED_USERS="user1@example.com,user2@example.com"
function getAuthorizedEmails(): string[] {
  const envEmails = process.env.AUTHORIZED_USERS;
  if (!envEmails) {
    console.error("Error: AUTHORIZED_USERS environment variable is not set");
    console.error("Usage: AUTHORIZED_USERS='email1@example.com,email2@example.com' bun run db:seed");
    process.exit(1);
  }

  return envEmails
    .split(",")
    .map(email => email.trim())
    .filter(email => email.length > 0);
}

async function seed() {
  const emails = getAuthorizedEmails();

  if (emails.length === 0) {
    console.error("Error: No valid emails found in AUTHORIZED_USERS");
    process.exit(1);
  }

  console.log("Seeding database...");

  await db.insert(authorizedUsers).values(
    emails.map(email => ({ email }))
  ).onConflictDoNothing();

  console.log("Database seeded successfully!");
  console.log(`Added ${emails.length} authorized user(s):`);
  emails.forEach(email => console.log(`  - ${email}`));
}

seed().catch(console.error);
