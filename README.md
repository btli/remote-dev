# Remote Dev

A modern web-based terminal interface for local development, featuring multi-session support, GitHub integration, and persistent sessions via tmux.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)

## Features

- **Multiple Terminal Sessions** - Run multiple terminals in browser tabs, switch between them seamlessly
- **Session Persistence** - Sessions survive browser close via tmux integration
- **GitHub Integration** - Connect your GitHub account, browse repositories, and clone with one click
- **Git Worktrees** - Create isolated worktrees for feature branches automatically
- **Modern UI** - Glassmorphism design with gradient accents and smooth animations
- **Secure Authentication** - Email allowlist with NextAuth v5 and optional GitHub OAuth

## Screenshots

```
┌─────────────────────────────────────────────────────────────────┐
│  [RD] Remote Dev                        GitHub ✓  user@example  │
├─────────────────────────────────────────────────────────────────┤
│  ● Project A   ● API Server   ● Tests   [+]                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ~/projects/api $ npm run dev                                   │
│  > api@1.0.0 dev                                                │
│  > next dev                                                     │
│                                                                 │
│  ▲ Next.js 15.0.0                                               │
│  - Local: http://localhost:3000                                 │
│                                                                 │
│  ~/projects/api $ █                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [tmux](https://github.com/tmux/tmux) (for session persistence)
- macOS, Linux, or WSL

### Installation

```bash
# Clone the repository
git clone https://github.com/btli/remote-dev.git
cd remote-dev

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your settings

# Initialize the database
bun run db:push

# Seed authorized users
bun run db:seed

# Start development servers
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

### Environment Variables

Create a `.env.local` file in the project root:

```bash
# Required - Generate with: openssl rand -base64 32
AUTH_SECRET=your-secret-key-here

# Optional - GitHub OAuth (for repository integration)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Optional - Server configuration
TERMINAL_PORT=3001
```

### GitHub OAuth Setup

To enable GitHub integration:

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name:** `Remote Dev`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/github/callback`
4. Copy the Client ID and generate a Client Secret
5. Add them to your `.env.local`

### Adding Authorized Users

Edit `src/db/seed.ts` to add email addresses:

```typescript
const authorizedEmails = [
  "your-email@example.com",
  "teammate@example.com",
];
```

Then run:

```bash
bun run db:seed
```

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Next.js    │    │   xterm.js   │    │   React UI   │       │
│  │   (SSR/RSC)  │    │  (Terminal)  │    │  (Sessions)  │       │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘       │
└─────────┼───────────────────┼───────────────────────────────────┘
          │ HTTP              │ WebSocket
          ▼                   ▼
┌─────────────────┐    ┌─────────────────┐
│  Next.js Server │    │ Terminal Server │
│   (port 3000)   │    │   (port 3001)   │
│                 │    │                 │
│  - Auth         │    │  - WebSocket    │
│  - API Routes   │    │  - node-pty     │
│  - React SSR    │    │  - tmux attach  │
└────────┬────────┘    └────────┬────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│     SQLite      │    │      tmux       │
│   (Drizzle)     │    │   (Sessions)    │
└─────────────────┘    └─────────────────┘
```

### Key Technologies

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript |
| UI Components | shadcn/ui, Tailwind CSS v4 |
| Terminal | xterm.js, node-pty |
| Authentication | NextAuth v5, GitHub OAuth |
| Database | SQLite (libsql), Drizzle ORM |
| Persistence | tmux sessions |
| Runtime | Bun (frontend), tsx (terminal server) |

### Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/          # Authentication endpoints
│   │   ├── github/        # GitHub integration
│   │   └── sessions/      # Session management
│   ├── login/             # Login page
│   └── page.tsx           # Main terminal interface
├── components/
│   ├── github/            # GitHub UI components
│   ├── session/           # Session management UI
│   ├── terminal/          # Terminal component
│   └── ui/                # shadcn/ui components
├── contexts/              # React contexts
├── db/                    # Database schema and config
├── hooks/                 # Custom React hooks
├── lib/                   # Utility functions
├── server/                # Terminal WebSocket server
├── services/              # Business logic services
└── types/                 # TypeScript type definitions
```

## Development

### Commands

```bash
# Development (runs both servers)
bun run dev

# Run servers separately
bun run dev:next      # Next.js on port 3000
bun run dev:terminal  # Terminal server on port 3001

# Code quality
bun run lint          # ESLint
bun run typecheck     # TypeScript

# Database
bun run db:push       # Push schema to database
bun run db:studio     # Open Drizzle Studio
bun run db:seed       # Seed authorized users

# Production
bun run build
bun run start
bun run start:terminal
```

### Service Layer

The application uses a clean service layer architecture:

- **SessionService** - Terminal session CRUD operations
- **TmuxService** - tmux session lifecycle management
- **GitHubService** - GitHub API integration, repository caching
- **WorktreeService** - Git worktree creation and management

### API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List user's sessions |
| `/api/sessions` | POST | Create new session |
| `/api/sessions/[id]` | GET | Get session details |
| `/api/sessions/[id]` | PATCH | Update session |
| `/api/sessions/[id]` | DELETE | Close session |
| `/api/github/repositories` | GET | List GitHub repos |
| `/api/github/repositories/[id]` | POST | Clone repository |
| `/api/github/worktrees` | POST | Create worktree |

## Session Persistence

Sessions persist through browser restarts using tmux:

1. **Create Session** - Creates a tmux session with unique name (`rdv-{uuid}`)
2. **Connect** - Terminal attaches to the tmux session
3. **Disconnect** - Only the attachment closes; tmux session continues
4. **Reconnect** - Reattaches to existing tmux session with full history

To list active tmux sessions:

```bash
tmux list-sessions | grep "^rdv-"
```

## Security

- **Email Allowlist** - Only pre-authorized emails can authenticate
- **JWT Sessions** - Secure, stateless session management
- **No Shell Injection** - Commands use `execFile` (not `exec`)
- **Local Only** - Designed for local development, not production deployment

## Troubleshooting

### Terminal won't connect

1. Ensure the terminal server is running: `bun run dev:terminal`
2. Check if tmux is installed: `tmux -V`
3. Check WebSocket port (default 3001) isn't blocked

### GitHub integration not working

1. Verify OAuth credentials in `.env.local`
2. Check callback URL matches exactly: `http://localhost:3000/api/auth/github/callback`
3. Ensure your GitHub account email is in the authorized users list

### Sessions not persisting

1. Verify tmux is installed and working: `tmux new -s test`
2. Check for tmux sessions: `tmux list-sessions`
3. Database might need syncing: `bun run db:push`

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Next.js](https://nextjs.org/) - React framework
- [tmux](https://github.com/tmux/tmux) - Terminal multiplexer
