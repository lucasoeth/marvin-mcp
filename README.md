# Amazing Marvin MCP Server

An MCP (Model Context Protocol) server for [Amazing Marvin](https://amazingmarvin.com/) - the ultimate productivity app. This server enables AI assistants like Claude to manage your tasks, projects, categories, and labels in Amazing Marvin.

## Features

### Task Management
- **Create tasks** - With support for inline syntax (`+today`, `#Category`, `@label`), priority levels, and frog marking
- **Get today's tasks** - View all tasks scheduled for today
- **Get due tasks** - View overdue tasks
- **Get inbox** - View unorganized tasks (no parent category/project)
- **Get tasks by date** - View tasks for any specific date
- **Search tasks** - Find tasks by keyword in titles/notes
- **Get all tasks** - Aggregate all accessible tasks
- **Complete tasks** - Mark tasks as done
- **Update tasks** - Modify title, dates, notes, priority, labels, and more
- **Delete tasks** - Remove tasks permanently
- **Get task details** - Retrieve full task information

### Project Management
- **Create projects** - With priority levels and scheduling
- **Get project details** - Retrieve project information
- **Update projects** - Modify project properties
- **Delete projects** - Remove projects permanently
- **Get children** - List all items under a project or category

### Organization
- **Get categories** - List all top-level categories
- **Get labels** - List all available labels

### Utilities
- **Test connection** - Verify API authentication

## Setup

### Choose Your Deployment Method

This MCP server can be run in two modes:

1. **Local Mode** (stdio) - Run directly on your machine for personal use
2. **Remote Mode** (HTTP) - Deploy to the internet for access from anywhere

#### Local Mode (Quick Start)

### 1. Get Your Amazing Marvin API Tokens

1. Open Amazing Marvin desktop or web app
2. Go to **Settings** (gear icon)
3. Navigate to **API** section
4. Copy your **API Token** and **Full Access Token**

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Server

```bash
npm run build
```

### 4. Configure Your MCP Client

Add the server to your MCP client configuration. For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "marvin": {
      "command": "node",
      "args": ["/path/to/marvin-mcp/dist/index.js"],
      "env": {
        "MARVIN_API_TOKEN": "your-api-token-here",
        "MARVIN_FULL_ACCESS_TOKEN": "your-full-access-token-here"
      }
    }
  }
}
```

For Claude Code, add to your settings:

```json
{
  "mcpServers": {
    "marvin": {
      "command": "node",
      "args": ["/path/to/marvin-mcp/dist/index.js"],
      "env": {
        "MARVIN_API_TOKEN": "your-api-token-here",
        "MARVIN_FULL_ACCESS_TOKEN": "your-full-access-token-here"
      }
    }
  }
}
```

#### Remote Mode (Deploy to Internet)

Want to access your Marvin MCP server from anywhere? Deploy it as a remote HTTP server!

**📱 Perfect for apps like Poke that support remote MCP servers!**

**See the simple guide:** [SIMPLE_REMOTE_SETUP.md](./SIMPLE_REMOTE_SETUP.md) (3 steps!)

**Quick overview:**
- Deploy to Coolify (or any platform)
- Simple API key authentication
- Access from multiple devices
- Built-in session management

**Super quick setup:**
1. Deploy to Coolify with your Marvin API tokens
2. Add your server URL to Poke
3. Start using Marvin tools!

**Environment variables to set in Coolify:**
```env
MARVIN_API_TOKEN=your-marvin-api-token
MARVIN_FULL_ACCESS_TOKEN=your-marvin-full-access-token
API_KEY=your-secure-api-key  # Optional but recommended
```

**Connect from Poke or similar apps:**
- Server URL: `https://your-server.com/mcp`
- API Key: Your `API_KEY` from above

For detailed instructions, see [SIMPLE_REMOTE_SETUP.md](./SIMPLE_REMOTE_SETUP.md).
For advanced features (multi-user, OAuth, etc.), see [REMOTE_DEPLOYMENT.md](./REMOTE_DEPLOYMENT.md).

## Available Tools (19 total)

### Task Tools
| Tool | Description |
|------|-------------|
| `marvin_create_task` | Create a new task with scheduling, labels, priority, and frog marking |
| `marvin_get_today_tasks` | Get all tasks scheduled for today |
| `marvin_get_due_tasks` | Get all overdue tasks |
| `marvin_get_inbox` | Get tasks without a parent (inbox) |
| `marvin_get_tasks_by_date` | Get tasks for a specific date |
| `marvin_search_tasks` | Search tasks by keyword |
| `marvin_get_all_tasks` | Get all accessible tasks |
| `marvin_complete_task` | Mark a task as complete |
| `marvin_update_task` | Update task properties including priority and labels |
| `marvin_delete_task` | Delete a task |
| `marvin_get_task` | Get detailed task information |

### Project Tools
| Tool | Description |
|------|-------------|
| `marvin_create_project` | Create a new project |
| `marvin_get_project` | Get project details |
| `marvin_update_project` | Update a project |
| `marvin_delete_project` | Delete a project |
| `marvin_get_children` | Get child items under a parent |

### Organization Tools
| Tool | Description |
|------|-------------|
| `marvin_get_categories` | List all categories |
| `marvin_get_labels` | List all labels |
| `marvin_test_connection` | Test API connection |

## Usage Examples

Once connected, you can ask your AI assistant:

- "Show me my tasks for today"
- "Create a task to review the quarterly report, due next Friday"
- "Mark the task about emails as complete"
- "What projects do I have?"
- "Add a task to call John under the Work category"
- "Show me all my overdue tasks"

## Task Creation Syntax

Amazing Marvin supports inline syntax in task titles:

- `+today` or `+tomorrow` - Schedule the task
- `+monday` or `+next week` - Schedule for specific days
- `#CategoryName` - Assign to a category
- `@labelName` - Add a label
- `~30m` or `~1h` - Set time estimate

Example: "Buy groceries +tomorrow @errands ~30m"

## Priority Levels

Tasks support two priority systems:

### Star Priority (isStarred)
- `1` - Yellow star (low priority)
- `2` - Orange star (medium priority)
- `3` - Red star (high priority)

### Frog Priority (isFrogged) - "Eat the Frog"
- `1` - Normal frog
- `2` - Baby frog
- `3` - Monster frog (most important task to tackle first)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MARVIN_API_TOKEN` | Yes | Your Amazing Marvin API token |
| `MARVIN_FULL_ACCESS_TOKEN` | Yes | Your Amazing Marvin full access token |

## Development

```bash
# Watch mode for development (local stdio mode)
npm run dev

# Build for production
npm run build

# Run the local stdio server
npm start

# Run the remote HTTP server (for testing remote mode locally)
npm run start:remote
```

## Files and Structure

- `src/index.ts` - Local stdio MCP server
- `src/remote-server.ts` - Remote HTTP MCP server
- `src/tools/` - Tool implementations (tasks, projects, categories, labels, account)
- `src/marvin-api.ts` - Amazing Marvin API client
- `nixpacks.toml` - Coolify/nixpacks deployment configuration
- `Dockerfile` - Docker deployment configuration
- `REMOTE_DEPLOYMENT.md` - Complete remote deployment guide

## License

MIT
