# Agent Architecture Comparison

## TL;DR

**Agent Switching:** User talks directly to specialized agents (Compass, Architect, etc.)  
**Delegation:** User talks to orchestrator, which internally uses subagents

---

## Pattern 1: Agent Switching

### How It Works
```
User → [Orchestrator] → User → [Compass Agent] → User → [Catalyst Agent]
         ↓ handoff           ↓ full conversation    ↓ full conversation
```

The user's **interface changes** - you're actually talking to different agents.

### Example Conversation
```
You: "I need help planning my day"
Orchestrator: "I'll connect you with The Compass, our morning planning specialist."

[INTERFACE SWITCHES TO COMPASS]

You: "Okay, what should I do first?"
Compass: "Good morning! Let's nail down your frog. What's the one task 
         you'd regret NOT finishing today?"
You: "Finishing the proposal"
Compass: "Perfect. That's your 9-11am block. High energy, high impact.
         What else is on your plate?"
You: "Maybe some emails and the standup meeting"
Compass: "Emails go to 2pm when your energy dips. Meeting is what time?"
```

**Key point:** You're having a full conversation with Compass. The Compass personality, decision-making, and workflow are directly controlling the chat.

### Implementation (Claude Agent SDK)

**File:** `examples/agent-switching-example.ts`

```typescript
// Each agent is a fully independent Agent instance
const compassAgent = new Agent({
  name: "The Compass",
  systemPrompt: `🧭 Full personality and workflow here...`,
  mcpServers: [marvinMcpClient],
});

// User's current agent changes based on handoffs
let currentAgent = "compass";
const response = await agents[currentAgent].run(userMessage);
```

### Pros
✅ **Rich personality** - Each agent has full conversational control  
✅ **Deep specialization** - Agent can have multi-turn workflows  
✅ **Clear context** - Agent knows it's the primary interface  
✅ **Lower token usage per turn** - Each agent has focused context

### Cons
❌ **Context handoff complexity** - Need to pass state between agents  
❌ **Disjointed experience** - User must explicitly switch agents  
❌ **Harder coordination** - Agents don't naturally collaborate  
❌ **User must know when to switch** - Or orchestrator must detect it

### Best For
- Desktop apps with explicit "agent selection" UI
- Deep, multi-turn workflows within one domain
- When you want distinct personality experiences
- Power users who understand the different agents

---

## Pattern 2: Delegation

### How It Works
```
User → [Orchestrator] → spawns → [Compass Subagent] → results → [Orchestrator] → User
         ↓ always here           ↓ internal only                   ↓ friendly response
```

The user **only talks to the orchestrator**. Subagents are invisible backend services.

### Example Conversation
```
You: "I need help planning my day"
Orchestrator: *[Internally calls Compass subagent, gets analysis]*
Orchestrator: "I've analyzed your schedule. You have 6 tasks totaling 4.5 hours.
               I recommend starting with the proposal - that's your biggest 
               challenge and you'll want your morning energy for it.
               
               Here's your optimal schedule:
               • 9-11am: Proposal (your frog 🐸)
               • 11-12pm: Standup meeting
               • 2-3pm: Email batch (low energy task)
               
               Sound good?"

You: "Yeah but I'm feeling really overwhelmed"
Orchestrator: *[Internally calls Guardian subagent, gets triage]*
Orchestrator: "I hear you. Looking at your load, you have 8 hours scheduled
               but only 6 hours available. Let's defer the presentation prep
               to tomorrow. That reduces today to 6 hours - much more doable.
               
               Want me to reschedule it?"
```

**Key point:** You're always talking to the same agent. It's seamlessly consulting specialists behind the scenes.

### Implementation (Claude Agent SDK)

**File:** `examples/delegation-example.ts`

```typescript
// Subagents return structured data, not conversational responses
const compassSubagent = new Agent({
  name: "Compass Subagent",
  systemPrompt: `Return structured plan in JSON format...`,
  mcpServers: [marvinMcpClient],
});

// Orchestrator calls subagents internally
const orchestratorResponse = await orchestratorAgent.run(userMessage);

if (orchestratorResponse.includes("CALL_COMPASS")) {
  const subagentResult = await compassSubagent.run(userMessage);
  // Send results back to orchestrator for friendly translation
  finalResponse = await orchestratorAgent.run(
    `Specialist returned: ${subagentResult}. Translate for user.`
  );
}
```

### Pros
✅ **Seamless experience** - User doesn't need to know about agents  
✅ **Context preservation** - Orchestrator maintains full history  
✅ **Easy coordination** - Can call multiple specialists in one turn  
✅ **Flexible routing** - Orchestrator decides what's needed

### Cons
❌ **Higher token usage** - Orchestrator + subagent calls  
❌ **Diluted personality** - Everything filtered through orchestrator  
❌ **Complexity** - More moving parts to debug  
❌ **Less specialization depth** - Subagents can't do multi-turn workflows

### Best For
- Chat interfaces (web, mobile, CLI)
- General productivity assistant vibes
- Users who want "one assistant" that handles everything
- Complex tasks requiring multiple specialists

---

## Key Difference: Who The User Talks To

### Agent Switching
```typescript
User → Compass (directly)
      "What's your frog today?"
      "That's too much, pick 3."
      "Schedule it for 9am."
```
**The specialized agent IS the interface.**

### Delegation
```typescript
User → Orchestrator → Compass → Orchestrator → User
      "I need to plan"   (analysis)   "Here's your plan"
```
**The orchestrator IS the interface. Specialists are invisible.**

---

## Decision Framework

### Choose Agent Switching if:
- You have a UI that can show "current agent"
- You want distinct personalities (drill sergeant Compass vs warm Guardian)
- Tasks are deep and specialized (30-minute planning session with Compass)
- Users are productivity enthusiasts who understand the system

### Choose Delegation if:
- You're building a chat interface (CLI, web, mobile)
- You want "one assistant" user experience
- Tasks are varied and quick ("plan my day" then "what's overdue?")
- Users are general public who want simple interaction

---

## Hybrid Approach

You can also combine both:

```typescript
// Default: Delegation for quick tasks
User: "What's due today?"
Orchestrator: *[quick delegation to Guardian]* "You have 3 overdue items..."

// Optional: Agent switching for deep workflows
User: "I need a full weekly review"
Orchestrator: "This is perfect for The Architect. Want me to hand you over 
               for a deep session? (You'll switch to talking directly with 
               The Architect for the next 10-15 minutes)"
User: "Yes"
[SWITCH TO ARCHITECT AGENT]
Architect: "Excellent. Let's start with your inbox..."
```

This gives you both convenience AND depth.

---

## Implementation Recommendation

**For Marvin MCP + Claude Agent SDK:**

I recommend starting with **Delegation** because:

1. **Simpler user mental model** - One assistant that knows everything
2. **Better for CLI/chat** - No UI needed to show "current agent"
3. **Easier to build** - Single entry point, orchestrator handles routing
4. **More forgiving** - User doesn't need to understand when to switch agents

You can always add agent switching later if you find specific workflows (like "weekly review") benefit from a dedicated multi-turn session.

**Start here:** `examples/delegation-example.ts`

---

## Next Steps

1. **Choose your pattern** based on your interface and user type
2. **Set up Claude Agent SDK** in your project
3. **Implement one specialist** (start with Compass for daily planning)
4. **Test the flow** with real Marvin data
5. **Add more specialists** as needed
6. **Consider hybrid** if you find some tasks need deep sessions

Questions? Check the Claude Agent SDK docs or ask me!
