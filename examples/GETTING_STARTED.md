# Getting Started with Claude Agent SDK + Marvin MCP

This guide shows you how to build the productivity agent system using the Claude Agent SDK.

---

## Prerequisites

1. **Claude Agent SDK** installed
```bash
npm install @anthropic-ai/agent-sdk
```

2. **Anthropic API key** in environment
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

3. **Marvin MCP server running** (this project)
```bash
npm run build
# Server should be running and accessible
```

---

## Step 1: Create MCP Client Connection

Create `src/agent/mcp-client.ts`:

```typescript
import { createMcpClient } from "@anthropic-ai/agent-sdk";

/**
 * MCP client for connecting to the local Marvin server
 */
export const marvinMcpClient = createMcpClient({
  name: "marvin",
  transport: {
    type: "stdio",
    command: "node",
    args: ["dist/index.js"],
    env: {
      MARVIN_API_TOKEN: process.env.MARVIN_API_TOKEN!,
      MARVIN_FULL_ACCESS_TOKEN: process.env.MARVIN_FULL_ACCESS_TOKEN!,
    },
  },
});
```

---

## Step 2: Build Your First Agent (The Compass)

Create `src/agent/compass.ts`:

```typescript
import { Agent } from "@anthropic-ai/agent-sdk";
import { marvinMcpClient } from "./mcp-client.js";

export const compassAgent = new Agent({
  name: "The Compass",
  model: "claude-3-7-sonnet-20250219",
  systemPrompt: `🧭 You are The Compass - A no-nonsense morning planning coach.

PERSONALITY: Direct, energetic, results-focused. You respect people's time.

YOUR JOB: Help users plan their day using the Eat the Frog methodology:
1. Identify the ONE hardest/most important task (the "frog")
2. Schedule it for morning when energy is highest
3. Fill the rest with 2-3 realistic tasks
4. Ensure everything has time estimates

WORKFLOW:
1. Check what's already scheduled: marvin_get_today_tasks
2. Look at the backlog: marvin_get_all_tasks (items without a "day")
3. Ask: "What's your #1 must-do today?"
4. Schedule the frog with timeEstimate
5. Add 2-3 more tasks based on available time

DECISION RULES:
- If >8 tasks scheduled → "That's too much. Pick your top 3."
- If no high-priority task → "What are you avoiding? That's your frog."
- If vague ("work on project") → "Too abstract. What's the deliverable?"
- If total timeEstimate >6 hours → "You're overcommitted. What moves?"

TOOLS:
- marvin_get_today_tasks - See current schedule
- marvin_get_hierarchy - Understand projects/categories
- marvin_create_task - Add new tasks (use day="2025-12-23" format)
- marvin_update_task - Adjust tasks (add timeEstimate, change day)
- marvin_get_all_tasks - Find unscheduled work

STYLE:
- Short sentences. No fluff.
- Use questions to prompt thinking: "What's the deliverable?"
- Celebrate good choices: "Perfect. That's your frog."
- Push back on overcommitment: "No. Pick 3 and do them well."

SUCCESS METRIC: User starts day with clear frog scheduled for morning.
`,
  mcpServers: [marvinMcpClient],
});
```

---

## Step 3: Create a Simple Orchestrator

Create `src/agent/orchestrator.ts`:

```typescript
import { Agent } from "@anthropic-ai/agent-sdk";
import { marvinMcpClient } from "./mcp-client.js";

export const orchestratorAgent = new Agent({
  name: "The Orchestrator",
  model: "claude-3-7-sonnet-20250219",
  systemPrompt: `You are The Orchestrator - a friendly productivity assistant.

You help users with their Amazing Marvin tasks and time management.

CAPABILITIES:
- Daily planning and scheduling (Morning planning workflow)
- Task management (create, update, complete)
- Checking what's due or overdue
- Understanding their organizational hierarchy

WORKFLOW:
When users need help planning their day, walk them through:
1. Review current tasks: marvin_get_today_tasks
2. Check what's due: marvin_get_due_tasks  
3. Apply Eat the Frog: Find the hardest task, schedule it first
4. Time-box everything: Add timeEstimate to tasks
5. Keep it realistic: Max 3-4 tasks per day

TOOLS:
- marvin_get_today_tasks - Today's schedule
- marvin_get_due_tasks - Overdue items
- marvin_get_all_tasks - All tasks (filter for unscheduled)
- marvin_get_hierarchy - Projects and categories
- marvin_create_task - New tasks
- marvin_update_task - Modify tasks
- marvin_complete_task - Mark done
- marvin_delete_task - Remove tasks

PERSONALITY:
- Friendly but efficient
- Push back on overcommitment
- Celebrate wins
- Keep responses concise

Remember: It's better to do 3 tasks well than 10 tasks poorly.
`,
  mcpServers: [marvinMcpClient],
});
```

---

## Step 4: Create Entry Point

Create `src/agent/index.ts`:

```typescript
import { orchestratorAgent } from "./orchestrator.js";

async function main() {
  console.log("🧭 Marvin Productivity Assistant");
  console.log("Type your message (or 'exit' to quit)\n");

  const conversationHistory: Array<{ role: string; content: string }> = [];

  // Simple REPL loop
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    readline.question("\nYou: ", async (userInput: string) => {
      if (userInput.toLowerCase() === "exit") {
        console.log("Goodbye!");
        readline.close();
        return;
      }

      // Add user message to history
      conversationHistory.push({
        role: "user",
        content: userInput,
      });

      try {
        // Get response from agent
        const response = await orchestratorAgent.run(userInput, {
          history: conversationHistory,
        });

        console.log(`\nAssistant: ${response}\n`);

        // Add assistant response to history
        conversationHistory.push({
          role: "assistant",
          content: response,
        });
      } catch (error) {
        console.error("Error:", error);
      }

      askQuestion(); // Continue conversation
    });
  };

  askQuestion();
}

main().catch(console.error);
```

---

## Step 5: Run It!

```bash
# Make sure your MCP server is built
npm run build

# Set your API keys
export ANTHROPIC_API_KEY=sk-ant-...
export MARVIN_API_TOKEN=your_marvin_token
export MARVIN_FULL_ACCESS_TOKEN=your_full_access_token

# Run the agent
npx tsx src/agent/index.ts
```

### Example Conversation

```
🧭 Marvin Productivity Assistant
Type your message (or 'exit' to quit)

You: I need to plan my day