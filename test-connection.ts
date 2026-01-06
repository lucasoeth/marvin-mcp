#!/usr/bin/env node

/**
 * Test script to check MCP server connection
 * Usage: node dist/test-connection.js <server-url> <api-key>
 */

async function testConnection(serverUrl: string, apiKey: string) {
  console.log('Testing MCP server connection...');
  console.log(`Server URL: ${serverUrl}`);
  console.log(`API Key: ${apiKey ? '***' + apiKey.slice(-4) : 'none'}`);
  console.log('');

  // Test 1: Health check
  console.log('1. Testing /health endpoint...');
  try {
    const healthUrl = serverUrl.replace('/mcp', '/health');
    const healthResponse = await fetch(healthUrl);
    const healthData = await healthResponse.json();
    console.log('✓ Health check passed:', JSON.stringify(healthData, null, 2));
  } catch (error) {
    console.error('✗ Health check failed:', error instanceof Error ? error.message : error);
    return;
  }

  console.log('');

  // Test 2: Initialize MCP connection (with token in query param)
  console.log('2. Testing MCP initialization with token in query param...');
  try {
    const urlWithToken = `${serverUrl}?token=${apiKey}`;
    const initResponse = await fetch(urlWithToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        },
        id: 1
      })
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error(`✗ MCP initialization failed with status ${initResponse.status}`);
      console.error('Response:', errorText);
      return;
    }

    const initData = await initResponse.json();
    console.log('✓ MCP initialization successful!');
    console.log('Response:', JSON.stringify(initData, null, 2));

    // Extract session ID if present
    const sessionId = initResponse.headers.get('mcp-session-id');
    if (sessionId) {
      console.log(`Session ID: ${sessionId}`);
    }

  } catch (error) {
    console.error('✗ MCP initialization failed:', error instanceof Error ? error.message : error);
    return;
  }

  console.log('');

  // Test 3: List tools
  console.log('3. Testing tools/list...');
  try {
    const urlWithToken = `${serverUrl}?token=${apiKey}`;
    const toolsResponse = await fetch(urlWithToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2
      })
    });

    if (!toolsResponse.ok) {
      const errorText = await toolsResponse.text();
      console.error(`✗ Tools list failed with status ${toolsResponse.status}`);
      console.error('Response:', errorText);
      return;
    }

    const toolsData = await toolsResponse.json();
    console.log('✓ Tools list successful!');
    console.log(`Found ${toolsData.result?.tools?.length || 0} tools`);
    if (toolsData.result?.tools) {
      console.log('Available tools:');
      toolsData.result.tools.forEach((tool: any) => {
        console.log(`  - ${tool.name}`);
      });
    }

  } catch (error) {
    console.error('✗ Tools list failed:', error instanceof Error ? error.message : error);
  }

  console.log('');
  console.log('Connection test complete!');
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node dist/test-connection.js <server-url> <api-key>');
  console.error('Example: node dist/test-connection.js https://your-server.com/mcp REDACTED-ROTATED-KEY');
  process.exit(1);
}

const [serverUrl, apiKey] = args;
testConnection(serverUrl, apiKey).catch(console.error);
