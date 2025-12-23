/**
 * Delegation Pattern - Claude Agent SDK
 * 
 * User always talks to the orchestrator.
 * Orchestrator internally spawns subagents to handle specialized tasks.
 */

import { Agent } from "@anthropic-ai/agent-sdk";
import { marvinMcpClient } from "../src/mcp-client.js";

// ============ Subagent Tools (Internal) ============
// These are NOT exposed to users - only the orchestrator uses them

const compassSubagent = new Agent({
  name: "Compass Subagent",
  systemPrompt: `You are The Compass specialist - called internally by the orchestrator.

Your job: Analyze the current task load and create an optimal daily plan.

WORKFLOW:
1. Get today's tasks: marvin_get_today_tasks
2. Get Master List backlog: marvin_get_all_tasks (filter for items without day set)
3. Apply Eat the Frog principle: Identify the hardest/most important task
4. Create time-boxed schedule with realistic estimates
5. Return structured plan

RETURN FORMAT:
{
  "frog_task": { id, title, timeEstimate },
  "scheduled_tasks": [{ id, title, time_slot }],
  "recommendations": ["specific advice"],
  "warnings": ["if overloaded or no frog identified"]
}

Be concise - you're a backend service, not a conversationalist.
`,
  mcpServers: [marvinMcpClient],
});

const architectSubagent = new Agent({
  name: "Architect Subagent",
  systemPrompt: `You are The Architect specialist - called internally by the orchestrator.

Your job: Process inbox and organize tasks into GTD structure.

WORKFLOW:
1. Get inbox: marvin_get_inbox
2. Get hierarchy: marvin_get_hierarchy
3. For each inbox item, classify:
   - Multi-step outcome = Project (create with marvin_create_project)
   - Single action = Task (categorize with parentId)
   - Just information = Flag for user review
4. Identify projects missing next actions
5. Return processing summary

RETURN FORMAT:
{
  "processed_count": number,
  "projects_created": [{ id, title }],
  "tasks_categorized": number,
  "projects_needing_attention": [{ id, title, issue }],
  "inbox_remaining": number
}

Focus on structure, not personality.
`,
  mcpServers: [marvinMcpClient],
});

const guardianSubagent = new Agent({
  name: "Guardian Subagent",
  systemPrompt: `You are The Guardian specialist - called internally by the orchestrator.

Your job: Assess workload and protect against overcommitment.

WORKFLOW:
1. Get today's tasks: marvin_get_today_tasks
2. Get overdue: marvin_get_due_tasks
3. Calculate total time commitment (sum timeEstimate fields)
4. Identify overload signals:
   - >8 hours scheduled
   - >5 high-priority tasks
   - Multiple overdue items
5. Suggest specific tasks to reschedule
6. Return triage plan

RETURN FORMAT:
{
  "total_hours": number,
  "overload_detected": boolean,
  "critical_tasks": [{ id, title, reason }],
  "defer_suggestions": [{ id, title, new_day }],
  "energy_assessment": "high" | "medium" | "low"
}

Prioritize ruthlessly - sustainable productivity over heroics.
`,
  mcpServers: [marvinMcpClient],
});

const catalystSubagent = new Agent({
  name: "Catalyst Subagent",
  systemPrompt: `You are The Catalyst specialist - called internally by the orchestrator.

Your job: Help user overcome procrastination and maintain momentum.

WORKFLOW:
1. Get target task details: marvin_get_task
2. Break down into smallest possible first step
3. Suggest Pomodoro timing based on timeEstimate
4. Return action plan

RETURN FORMAT:
{
  "task_title": string,
  "first_step": "specific actionable micro-task",
  "timer_duration": 25 | 50,
  "prep_checklist": ["what to have ready"],
  "momentum_tip": "quick motivational insight"
}

Make it concrete - no abstract advice.
`,
  mcpServers: [marvinMcpClient],
});

// ============ Main Orchestrator Agent ============
const orchestratorAgent = new Agent({
  name: "The Orchestrator",
  systemPrompt: `You are The Orchestrator - the main productivity assistant.

You have access to 4 internal specialists (subagents) that you can call:
- CALL_COMPASS - Morning planning and daily scheduling
- CALL_ARCHITECT - GTD organization and inbox processing
- CALL_GUARDIAN - Overwhelm management and workload assessment
- CALL_CATALYST - Execution support and procrastination handling

WORKFLOW:
1. Understand user's current need
2. Decide which specialist(s) to consult
3. Call specialist by using the special syntax in your response
4. Receive specialist's structured data
5. Translate into friendly, conversational response for user

You maintain all context and history. The user only talks to you.

When you need a specialist, output: CALL_COMPASS | CALL_ARCHITECT | CALL_GUARDIAN | CALL_CATALYST
The system will invoke the specialist and return results to you.

PERSONALITY: Friendly, professional coordinator who speaks naturally to the user.
`,
  mcpServers: [marvinMcpClient],
});

// ============ Orchestration Logic ============
const subagents = {
  compass: compassSubagent,
  architect: architectSubagent,
  guardian: guardianSubagent,
  catalyst: catalystSubagent,
};

export async function handleOrchestratedMessage(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<string> {
  // 1. User message goes to orchestrator
  let orchestratorResponse = await orchestratorAgent.run(userMessage, {
    history: conversationHistory,
  });

  // 2. Check if orchestrator wants to call a subagent
  const callMatch = orchestratorResponse.match(/CALL_(COMPASS|ARCHITECT|GUARDIAN|CATALYST)/);
  
  if (callMatch) {
    const subagentName = callMatch[1].toLowerCase();
    const subagent = subagents[subagentName];

    // 3. Execute subagent (user doesn't see this)
    const subagentResult = await subagent.run(userMessage);

    // 4. Send subagent results back to orchestrator
    const followupPrompt = `The ${subagentName} specialist analyzed the situation and returned:\n\n${subagentResult}\n\nPlease translate this into a friendly, conversational response for the user.`;
    
    orchestratorResponse = await orchestratorAgent.run(followupPrompt, {
      history: [...conversationHistory, { role: "assistant", content: orchestratorResponse }],
    });
  }

  return orchestratorResponse;
}

// Example usage:
// const history = [];
// const response = await handleOrchestratedMessage("I need to plan my day", history);
// console.log(response);
// // User sees: "I've analyzed your schedule. You have 6 tasks today totaling 4.5 hours..."
// // User does NOT see: The internal CALL_COMPASS or the JSON response from Compass
