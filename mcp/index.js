#!/usr/bin/env node
// stdio <-> the Nuttle desktop app's local MCP server (streamable HTTP on 127.0.0.1:8787).
// For clients that only launch local commands (e.g. Claude Desktop). When the app isn't running it
// still answers, telling the agent to open Nuttle; once the app is up it connects and announces the tools.
'use strict';
const http = require('node:http');
const readline = require('node:readline');
const { version } = require('./package.json');

const UP = new URL(process.env.NUTTLE_MCP_URL || 'http://127.0.0.1:8787/mcp');
const OFFLINE = "The Nuttle desktop app isn't running on this computer. Ask the user to open Nuttle "
  + '(free download for Windows: https://nuttle.dev/download/windows?src=npm), then try again.';
const STATUS_TOOL = {
  name: 'nuttle_status',
  description: "Nuttle isn't running. Call this to see how to get the user's browsing data.",
  inputSchema: { type: 'object', properties: {} },
};

let initParams = null;  // the client's initialize params, replayed whenever we (re)connect upstream
let up = null;          // { sid, proto } of the live upstream session
let connecting = null;
let wasOffline = false;

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

// One POST upstream. Resolves { status, sid, messages }; rejects only when the app can't be reached.
function post(body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(UP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const messages = [];
        if (/event-stream/.test(res.headers['content-type'] || '')) {
          for (const ev of buf.split(/\r?\n\r?\n/)) {
            const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
            if (data.trim()) messages.push(JSON.parse(data));
          }
        } else if (buf.trim()) {
          messages.push(JSON.parse(buf));
        }
        resolve({ status: res.statusCode, sid: res.headers['mcp-session-id'], messages });
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

// initialize + initialized upstream; returns the upstream initialize result
async function connect() {
  const r = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: initParams });
  const result = r.messages.find((m) => m.id === 0)?.result;
  if (!result || !r.sid) throw new Error(`Nuttle answered initialize with HTTP ${r.status}`);
  up = { sid: r.sid, proto: result.protocolVersion };
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, headers());
  if (wasOffline) {
    wasOffline = false;
    send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }
  return result;
}
const ensure = () => up || (connecting ||= connect().finally(() => { connecting = null; }));
const headers = () => ({ 'mcp-session-id': up.sid, 'mcp-protocol-version': up.proto });

function offlineReply(msg) {
  wasOffline = true;
  if (msg.method === 'tools/list') return { tools: [STATUS_TOOL] };
  if (msg.method === 'tools/call') return { content: [{ type: 'text', text: OFFLINE }], isError: true };
  if (msg.method === 'ping') return {};
  if (msg.method === 'prompts/list') return { prompts: [] };
  return null;
}

async function handle(msg) {
  const isRequest = msg.id !== undefined && msg.method;
  if (msg.method === 'initialize') {
    initParams = msg.params;
    try {
      return send({ jsonrpc: '2.0', id: msg.id, result: await connect() });
    } catch {
      wasOffline = true;
      return send({ jsonrpc: '2.0', id: msg.id, result: {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: true }, prompts: {} },
        serverInfo: { name: 'nuttle', version },
        instructions: OFFLINE,
      } });
    }
  }
  if (msg.method === 'notifications/initialized') return;  // already sent our own upstream
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensure();
      const r = await post(msg, headers());
      if (r.status === 404 && attempt === 0) { up = null; continue; }  // app restarted: new session, retry once
      r.messages.forEach(send);
      if (isRequest && !r.messages.some((m) => m.id === msg.id)) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `Nuttle answered HTTP ${r.status}` } });
      }
      return;
    } catch (e) {
      up = null;
      if (!isRequest) return;
      const result = offlineReply(msg);
      return send(result ? { jsonrpc: '2.0', id: msg.id, result }
        : { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: OFFLINE } });
    }
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg).catch((e) => process.stderr.write(`[nuttle-mcp] ${e.stack || e}\n`));
});
