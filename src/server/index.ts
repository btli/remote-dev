import { config } from "dotenv";
import { createTerminalServer } from "./terminal";

// Load .env.local to match Next.js environment
config({ path: ".env.local" });

const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "3001");

createTerminalServer(TERMINAL_PORT);
