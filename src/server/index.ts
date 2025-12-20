import { createTerminalServer } from "./terminal";

const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "3001");

createTerminalServer(TERMINAL_PORT);
