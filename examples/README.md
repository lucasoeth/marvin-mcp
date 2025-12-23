# Claude Agent SDK Implementation Examples

This directory contains implementation examples for building productivity agents with the Claude Agent SDK and Marvin MCP server.

## Files

### 1. `ARCHITECTURE_COMPARISON.md`
**Comprehensive guide comparing two agent orchestration patterns:**

- **Agent Switching Pattern** - User directly talks to specialized agents
  - User interface changes as they talk to different agents (Compass, Architect, Guardian, Catalyst)
  - Rich personalities and deep specialized workflows
  - Best for desktop apps with explicit agent selection UI
  
- **Delegation Pattern** - User always talks to orchestrator, which spawns internal subagents
  - Seamless single-assistant experience
  - Subagents are invisible backend services
  - Best for chat interfaces (CLI, web, mobile)

**Includes:**
- Visual diagrams of both patterns
- Pros/cons comparison
- Decision framework for choosing
- Hybrid approach combining both
- Recommendation: Start with Delegation pattern

### 2. `agent-switching-example.ts`
**Complete TypeScript implementation of Agent Switching pattern**

Shows how to build:
- Independent Agent instances for each specialist
- The Orchestrator that routes users to specialists
- Router logic with handoff detection (HANDOFF:compass syntax)
- State management for tracking current agent

Example:
```typescript
let currentAgent = "orchestrator";
const result = await handleUserMessage(currentAgent, "I need to plan my day");
currentAgent = result.nextAgent; // Now "compass"
```

### 3. `delegation-example.ts`
**Complete TypeScript implementation of Delegation pattern**

Shows how to build:
- Subagents that return structured JSON (not conversational)
- Main orchestrator that translates subagent results
- Internal routing with CALL_COMPASS syntax
- Seamless multi-specialist coordination

Example:
```typescript
const response = await handleOrchestratedMessage("I need to plan my day");
// User sees friendly response
// Doesn't see internal Compass subagent call
```

### 4. `GETTING_STARTED.md`
**Step-by-step implementation guide**

Covers:
1. Installing Claude Agent SDK
2. Setting up MCP client connection
3. Building your first agent (The Compass)
4. Creating a simple orchestrator
5. Building a REPL interface
6. Running the system end-to-end

Perfect for getting from zero to working agent in 30 minutes.

## Quick Start

### Prerequisites
```bash
npm install @anthropic-ai/agent-sdk
export ANTHROPIC_API_KEY=sk-ant-...
export MARVIN_API_TOKEN=...
export MARVIN_FULL_ACCESS_TOKEN=...
```

### Recommended Path

1. **Read** `ARCHITECTURE_COMPARISON.md` to understand patterns
2. **Choose** Delegation pattern (recommended for beginners)
3. **Follow** `GETTING_STARTED.md` step-by-step
4. **Reference** `delegation-example.ts` for implementation details
5. **Extend** with additional specialists as needed

## The Four Specialists

All examples include these productivity agents:

### 🧭 The Compass
- **Role:** Morning planning & daily focus
- **Personality:** Direct drill sergeant
- **Workflow:** Eat the Frog methodology
- **Tools:** Today's tasks, scheduling, time-boxing

### 🏗️ The Architect  
- **Role:** Weekly reviews & GTD maintenance
- **Personality:** Methodical strategist
- **Workflow:** GTD 5-step process (Collect, Clarify, Organize, Reflect, Engage)
- **Tools:** Inbox processing, project creation, hierarchy management

### 🛡️ The Guardian
- **Role:** Energy & overwhelm management
- **Personality:** Compassionate protector
- **Workflow:** Workload triage and sustainable scheduling
- **Tools:** Due tasks, rescheduling, workload assessment

### ⚡ The Catalyst
- **Role:** Execution & momentum
- **Personality:** Enthusiastic workout buddy
- **Workflow:** Pomodoro technique and procrastination busting
- **Tools:** Task completion, progress tracking, quick wins

## Architecture Decision

### For Chat/CLI/Mobile Apps → Use Delegation
- Single conversational interface
- Transparent specialist coordination
- Easier to build and maintain
- Better token efficiency for quick tasks

### For Desktop/Power User Apps → Use Agent Switching
- Distinct personalities per specialist
- Deep multi-turn specialized workflows
- Requires UI to show "current agent"
- Better for dedicated sessions (30+ min weekly review)

### Hybrid Approach
- Default to Delegation for quick interactions
- Offer explicit handoff for deep sessions
- Best of both worlds

## Next Steps

1. **Prototype:** Follow GETTING_STARTED.md to build basic orchestrator
2. **Test:** Try daily planning workflow with real Marvin data
3. **Extend:** Add Guardian for overwhelm management
4. **Deploy:** Integrate into your preferred interface (CLI, Slack, web app)
5. **Iterate:** Gather feedback and refine agent personalities

## Resources

- **Agent Prompts:** See `/AGENT_PROMPTS.md` for detailed system prompts
- **Claude Agent SDK:** https://github.com/anthropics/anthropic-sdk-typescript
- **MCP Docs:** https://modelcontextprotocol.info
- **Amazing Marvin API:** https://help.amazingmarvin.com/en/articles/4262782-api-documentation

## Questions?

The architecture comparison document includes:
- Detailed pros/cons analysis
- Code walkthroughs
- Decision framework
- Common pitfalls
- Best practices

Start there if you're unsure which pattern to use!
