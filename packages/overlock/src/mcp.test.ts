import { describe, expect, it, vi } from 'vitest';
import { analyze } from './analyze.js';
import {
  LATEST_PROTOCOL_VERSION,
  MessageBuffer,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
  handleMessage,
  type JsonRpcRequest,
  type McpDeps,
} from './mcp.js';
import { summarize } from './summary.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const dirty = analyze({ diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")) });
const clean = analyze({ diff: '' });

function deps(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    version: '9.9.9',
    check: () => dirty,
    report: () => summarize([]),
    ...overrides,
  };
}

function send(message: Partial<JsonRpcRequest>, d = deps()) {
  return handleMessage({ jsonrpc: '2.0', method: 'ping', ...message } as JsonRpcRequest, d);
}

describe('initialize', () => {
  it('echoes a protocol version it knows', () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const res = send({ id: 1, method: 'initialize', params: { protocolVersion: version } });
      expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(version);
    }
  });

  it('answers with its own version when the client asks for one it does not know', () => {
    const res = send({ id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    );
  });

  it('survives a missing or non-string protocolVersion', () => {
    expect(send({ id: 1, method: 'initialize', params: {} })).toBeTruthy();
    expect(send({ id: 1, method: 'initialize' })).toBeTruthy();
  });

  it('declares tools and identifies itself', () => {
    const result = send({ id: 1, method: 'initialize', params: {} })?.result as {
      capabilities: { tools: unknown };
      serverInfo: { name: string; version: string };
    };

    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo).toEqual({ name: 'overlock', version: '9.9.9' });
  });
});

describe('framing', () => {
  // Replying to a notification is the classic way to wedge a stdio server.
  it('never answers a notification', () => {
    expect(send({ method: 'notifications/initialized' })).toBeNull();
    expect(send({ id: null, method: 'notifications/cancelled' })).toBeNull();
  });

  it('answers ping', () => {
    expect(send({ id: 7, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('rejects an unknown method with the JSON-RPC code for it', () => {
    expect(send({ id: 2, method: 'resources/list' })?.error?.code).toBe(-32601);
  });
});

describe('tools/list', () => {
  it('advertises both tools with input schemas', () => {
    const { tools } = send({ id: 3, method: 'tools/list' })?.result as { tools: typeof TOOLS };

    expect(tools.map((t) => t.name)).toEqual(['overlock_check', 'overlock_report']);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('tells an agent when to call it, not just what it does', () => {
    expect(TOOLS[0].description).toContain('before reporting a coding task complete');
  });
});

describe('tools/call', () => {
  it('returns the compact report, plus the JSON when there is something to act on', () => {
    const result = send({
      id: 4,
      method: 'tools/call',
      params: { name: 'overlock_check', arguments: {} },
    })?.result as { content: { text: string }[]; isError: boolean };

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.text).toContain('1 finding');
    expect(JSON.parse(result.content[1]?.text ?? '{}')).toMatchObject({ schema: 1, ok: false });
  });

  it('costs one line when the patch is clean', () => {
    const result = send(
      { id: 4, method: 'tools/call', params: { name: 'overlock_check', arguments: {} } },
      deps({ check: () => clean }),
    )?.result as { content: unknown[] };

    expect(result.content).toHaveLength(1);
  });

  it('passes arguments through', () => {
    const check = vi.fn(() => clean);
    send(
      {
        id: 4,
        method: 'tools/call',
        params: {
          name: 'overlock_check',
          arguments: { base: 'main', staged: true, failOn: 'medium' },
        },
      },
      deps({ check }),
    );

    expect(check).toHaveBeenCalledWith({ base: 'main', staged: true, failOn: 'medium' });
  });

  it('ignores arguments of the wrong type rather than passing them on', () => {
    const check = vi.fn(() => clean);
    send(
      {
        id: 4,
        method: 'tools/call',
        params: { name: 'overlock_check', arguments: { base: 42, staged: 'yes' } },
      },
      deps({ check }),
    );

    expect(check).toHaveBeenCalledWith({});
  });

  it('serves the report tool', () => {
    const result = send({
      id: 5,
      method: 'tools/call',
      params: { name: 'overlock_report', arguments: { days: 7 } },
    })?.result as { content: { text: string }[] };

    expect(result.content[0]?.text).toContain('nothing recorded');
  });

  it('rejects an unknown tool and a missing name', () => {
    expect(send({ id: 6, method: 'tools/call', params: { name: 'rm_rf' } })?.error?.code).toBe(
      -32602,
    );
    expect(send({ id: 6, method: 'tools/call', params: {} })?.error?.code).toBe(-32602);
  });

  // A transport-level error would just look like a broken server; inside the
  // result the agent can read what went wrong and react.
  it('reports a failure to run inside the result, not as a protocol error', () => {
    const result = send(
      { id: 7, method: 'tools/call', params: { name: 'overlock_check', arguments: {} } },
      deps({
        check: () => {
          throw new Error('not a git repository');
        },
      }),
    );

    expect(result?.error).toBeUndefined();
    const payload = result?.result as { content: { text: string }[]; isError: boolean };
    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain('not a git repository');
  });
});

describe('MessageBuffer', () => {
  it('reads whole lines', () => {
    const buffer = new MessageBuffer();
    const messages = buffer.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe('ping');
  });

  // stdin arrives in arbitrary pieces; a message split across two reads is the
  // normal case, not an edge one.
  it('holds a partial line until the rest arrives', () => {
    const buffer = new MessageBuffer();
    expect(buffer.push('{"jsonrpc":"2.0","id":1,"me')).toEqual([]);
    expect(buffer.push('thod":"ping"}\n')).toHaveLength(1);
  });

  it('reads several messages from one chunk', () => {
    const buffer = new MessageBuffer();
    const line = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n';
    expect(buffer.push(line + line + line)).toHaveLength(3);
  });

  it('drops blank and unparseable lines without dying', () => {
    const buffer = new MessageBuffer();
    expect(buffer.push('\n  \nnot json\n{"no":"method"}\n')).toEqual([]);
  });
});
