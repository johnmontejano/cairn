import Link from 'next/link';
import { Badge, Callout, Card, Disclosure, EmptyState, LinkButton } from '@cairn/ui';
import { MCP_PROTOCOL_REVISION, PRODUCT } from '@cairn/config';
import { CANONICAL_DOCS, memoryTypes } from '@cairn/domain';
import { AppShell } from '@/components/chrome';
import { ActionForm, CopyableCode, SubmitButton } from '@/components/forms';
import { createConnectedAi, revokeConnectedAi } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadConnections } from '@/server/views';

export const metadata = { title: 'AI tools' };
export const dynamic = 'force-dynamic';

/**
 * Connected AIs.
 *
 * The page a non-technical person has to get through without learning what MCP
 * is. The plain explanation comes first; the protocol details live inside a
 * disclosure for whoever needs to paste a configuration file.
 */
/**
 * One card per tool, each carrying the exact thing to copy.
 *
 * One "connect" instruction cannot be right for all of these. Some read a JSON
 * config file, some take a shell command, some need a setting toggled first.
 * And the card is only honest if the thing it tells you to paste is *on the
 * card* — a card describing an address kept three sections lower is a
 * scavenger hunt, and the moment someone is unsure whether they did it right
 * is the moment they stop.
 *
 * `supported` is not decoration. A tool listed without saying it does not work
 * yet costs someone a wasted attempt and the belief that they broke it; naming
 * it plainly costs nothing and is true.
 */
interface McpClientCard {
  id: string;
  name: string;
  /** One sentence saying literally where the copied thing goes. */
  how: string;
  supported: boolean;
  availability?: 'works' | 'plan' | 'not-yet';
  copy?: { value: string; label: string };
  /** One line of small print under the thing to copy. */
  note?: string;
  /**
   * Folded-away second routes.
   *
   * The important one is the prompt you hand the tool itself. For Claude Code,
   * Codex and Gemini the setup *is* a command, and those three can run a
   * command — so the shortest honest instruction is not "open a terminal and
   * type this", it is "tell it to do this". Every such prompt stops at the
   * sign-in and hands that part back, because an agent must never be the thing
   * holding your password. Tools where setup is a menu toggle get no prompt: an
   * agent
   * cannot click a menu in someone else's app, and pretending otherwise sends
   * people down a dead end.
   */
  extras?: ReadonlyArray<{
    summary: string;
    body: string;
    copy?: { value: string; label: string };
  }>;
}

function mcpClients(signInMode: boolean, mcpUrl: string): ReadonlyArray<McpClientCard> {
  if (!signInMode) {
    return [
      {
        id: 'claude',
        name: 'Claude Desktop',
        how: 'Add Cairn to your MCP servers in Settings, then paste the connection code when it asks.',
        supported: true,
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        how: 'Run the claude mcp add command in your terminal, then paste the connection code.',
        supported: true,
      },
      {
        id: 'codex',
        name: 'Codex',
        how: 'Add Cairn to the MCP servers in Codex, then paste the connection code as the bearer token.',
        supported: true,
      },
      {
        id: 'cursor',
        name: 'Cursor',
        how: 'Add Cairn under MCP in Cursor settings, with the connection code as the token.',
        supported: true,
      },
      {
        id: 'vscode',
        name: 'VS Code',
        how: 'Add Cairn through the MCP extension, using the connection code to sign in.',
        supported: true,
      },
      {
        id: 'gemini',
        name: 'Gemini in your terminal',
        how: 'Run the gemini mcp add command in your terminal, with the connection code as the token.',
        supported: true,
      },
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        how: 'Needs the sign-in method this copy of Cairn does not have turned on. Connection codes are the tested path here.',
        supported: false,
      },
    ];
  }
  // Claude Code and Codex first: they are the pair most people want talking to
  // each other. Gemini follows them because it is the third that is one command
  // and can do its own setup. The two that need a menu, an owner or a plan come
  // after, and the one that does not work yet is last.
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      how: 'Paste this into your terminal. Your browser opens so you can say yes here.',
      supported: true,
      copy: {
        value: `claude mcp add --transport http ${PRODUCT.slug} --scope user ${mcpUrl}`,
        label: 'Copy command',
      },
      note: 'Then start Claude Code and type /mcp to finish signing in. Added this way, Cairn is there in every project on this computer.',
      extras: [
        {
          summary: 'Or ask Claude Code to set it up',
          body: 'Paste this into a Claude Code session and it does the setup itself. It stops at the sign-in and hands that part back to you.',
          copy: {
            value: `Set up my ${PRODUCT.name} memory in Claude Code. Run: claude mcp add --transport http ${PRODUCT.slug} --scope user ${mcpUrl} — then run claude mcp list, show me what it says, and tell me to type /mcp so I can sign in myself. Never ask me for a password, a token or a key.`,
            label: 'Copy prompt',
          },
        },
      ],
    },
    {
      id: 'codex',
      name: 'Codex',
      how: 'Paste this into your terminal. Codex opens your browser so you can say yes here.',
      supported: true,
      copy: {
        value: `codex mcp add ${PRODUCT.slug} --url ${mcpUrl}`,
        label: 'Copy command',
      },
      note: 'Then quit and reopen Codex, and type /mcp to check. If the command does nothing, update Codex first — signing in needs version 0.77 or newer.',
      extras: [
        {
          summary: 'Or ask Codex to set it up',
          body: 'Paste this into a Codex session and it does the setup itself. It stops at the sign-in and hands that part back to you.',
          copy: {
            value: `Set up my ${PRODUCT.name} memory in Codex. Run: codex mcp add ${PRODUCT.slug} --url ${mcpUrl} — a browser will open and I will sign in myself. Then run codex mcp list and show me what it says. Never ask me for a password, a token or a key.`,
            label: 'Copy prompt',
          },
        },
        {
          summary: 'If you use the Codex editor extension or the ChatGPT desktop app',
          body: `In the ChatGPT desktop app, switch to the Codex side first — Cairn attaches to Codex, not to ordinary ChatGPT chat. Then, in either app, open settings and find the servers section (some versions call it MCP servers, others Integrations and MCP — same place), add a server called ${PRODUCT.slug}, choose Streamable HTTP, and paste this address. Save, restart, then choose Authenticate next to ${PRODUCT.slug}. The terminal, the editor extension and the Codex side of the desktop app share one set of settings, so doing it in any one of them covers all three. If your ChatGPT plan does not include Codex, that settings section is not there at all.`,
          copy: { value: mcpUrl, label: 'Copy address' },
        },
      ],
    },
    {
      id: 'gemini',
      name: 'Gemini in your terminal',
      how: 'Paste this into your terminal, then sign in from inside Gemini. Your browser opens so you can say yes here.',
      supported: true,
      copy: {
        value: `gemini mcp add --transport http --scope user ${PRODUCT.slug} ${mcpUrl}`,
        label: 'Copy command',
      },
      note: `The first time you start Gemini it says Cairn needs signing in. That message is expected, not a mistake: type /mcp auth ${PRODUCT.slug} to sign in, then /mcp to check. Signing in needs Gemini version 0.30 or newer.`,
      extras: [
        {
          summary: 'Or ask Gemini to set it up',
          body: 'Paste this into a Gemini session and it does the setup itself. It stops at the sign-in and hands that part back to you.',
          copy: {
            value: `Set up my ${PRODUCT.name} memory in Gemini. Run: gemini mcp add --transport http --scope user ${PRODUCT.slug} ${mcpUrl} — keep --transport http and --scope user exactly as written, and do not add a header, a token or a key. Then run gemini mcp list, show me what it says, and tell me to type /mcp auth ${PRODUCT.slug} so I can sign in myself. Never ask me for a password, a token or a key.`,
            label: 'Copy prompt',
          },
        },
        {
          summary: 'If Gemini is not on your computer yet',
          body: 'You need Node.js version 20 or newer first — if you do not have it, get it from nodejs.org. Then run this in your terminal. Running it again is also how you get the newest version later.',
          copy: { value: 'npm install -g @google/gemini-cli@latest', label: 'Copy command' },
        },
        {
          summary: 'If Gemini says it lost the connection',
          body: 'Some versions of Gemini drop the connection shortly after you sign in. Quit Gemini, start it again, and type /mcp. If it keeps happening, install the newest version using the step above. On a computer with no browser, signing in cannot work at all — make a connection code further down this page and use that instead.',
        },
      ],
    },
    {
      id: 'claude',
      name: 'Claude',
      how: 'In Claude, open Connectors in your settings, choose to add a custom connector, and paste this address.',
      supported: true,
      copy: { value: mcpUrl, label: 'Copy address' },
      note: 'Connectors sits under Customize in newer versions and under Settings in older ones. Claude brings you back here, and you say yes once.',
      extras: [
        {
          summary: 'If you are on a Team or Enterprise plan',
          body: 'Only an owner can add it, and they only do it once. After that everyone else opens the same Connectors screen and chooses Connect, signing in with their own Cairn account.',
        },
      ],
    },
    {
      // Antigravity is the one tool here that cannot use the sign-in flow.
      // Its own sign-in for servers like this is known to be broken — it
      // forgets to send the pass on the first request and the connection is
      // refused — so a connection code is the honest route rather than the
      // consolation prize. Saying which part is broken, and whose, is the
      // difference between a person retrying forever and a person finishing.
      id: 'antigravity',
      name: 'Antigravity',
      how: 'Make a connection code below, paste it into the code here, then put the whole thing in Antigravity’s server settings file.',
      supported: true,
      copy: {
        value: `{
  "mcpServers": {
    "${PRODUCT.slug}": {
      "serverUrl": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer PASTE_YOUR_CONNECTION_CODE_HERE"
      }
    }
  }
}`,
        label: 'Copy settings',
      },
      note: 'In Antigravity, open the Agent panel on the right, choose MCP Servers, then Manage MCP Servers, then View raw config — that opens the right file whichever version you have. Paste this inside, save, and press Refresh.',
      extras: [
        {
          summary: 'Why this one needs a code and the others do not',
          body: 'Antigravity can sign in to servers like Cairn on paper, but in the versions shipping today it forgets to send the pass on its first request, so the connection is refused. Google has an open report about it. A connection code sidesteps that entirely. If a later version fixes it, you can delete the Authorization line and use the sign-in instead.',
        },
        {
          summary: 'If it does not appear after saving',
          body: 'Quit Antigravity completely and open it again — some versions only read that file at startup. Then ask it “what Cairn tools do you have?” If it names them, it is genuinely connected. One thing to watch: the address line must say serverUrl. Settings copied from Cursor or VS Code say url instead, and Antigravity ignores those without showing an error.',
        },
      ],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      how: 'In Cursor settings, add Cairn under MCP with this address. It sends you here to approve.',
      supported: true,
      copy: { value: mcpUrl, label: 'Copy address' },
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT in your browser',
      how: 'Not dependable yet here — it needs a Business or Enterprise workspace with developer mode switched on first. The desktop app is the better route: set up Codex above, then switch to the Codex side of the desktop app, where Cairn is already waiting.',
      supported: false,
      availability: 'plan',
      note: 'Ordinary ChatGPT chat, in the browser or in the desktop app, does not read the Codex settings, so Cairn does not appear there.',
      extras: [
        {
          summary: 'If you do have a Business or Enterprise workspace',
          body: 'An admin turns on developer mode for the workspace, then you open Apps in your settings, choose Create, paste this address, and pick sign-in when it asks how to connect. Two things to expect: it may only be able to look things up, and you may have to sign in again after a while.',
          copy: { value: mcpUrl, label: 'Copy address' },
        },
      ],
    },
  ];
}

const PRIMARY_AGENT_META = [
  {
    id: 'claude',
    label: 'Claude',
    mark: 'Cl',
    detail: 'Claude web and desktop',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    mark: '>_',
    detail: 'Anthropic terminal agent',
  },
  {
    id: 'codex',
    label: 'Codex',
    mark: 'Cx',
    detail: 'App, terminal and editor',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    mark: 'GPT',
    detail: 'Workspace plan required',
  },
] as const;

type PrimaryAgentId = (typeof PRIMARY_AGENT_META)[number]['id'];
type ConnectionStatus = 'Connected' | 'Working';

function primaryAgentIdForConnection(name: string): PrimaryAgentId | null {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (normalized.includes('claude code')) return 'claude-code';
  if (normalized.includes('codex')) return 'codex';
  if (normalized.includes('chatgpt') || normalized.includes('openai')) return 'chatgpt';
  if (normalized.includes('claude')) return 'claude';
  return null;
}

function AvailabilityBadge({
  client,
  connectionStatus,
}: {
  client: McpClientCard;
  connectionStatus?: ConnectionStatus;
}) {
  if (connectionStatus) return <Badge tone="good">{connectionStatus}</Badge>;
  if (client.availability === 'plan') return <Badge tone="warn">Plan dependent</Badge>;
  if (!client.supported || client.availability === 'not-yet') {
    return <Badge tone="warn">Not yet</Badge>;
  }
  return <Badge tone="good">Works today</Badge>;
}

function ClientInstructions({
  client,
  connectionStatus,
}: {
  client: McpClientCard;
  connectionStatus?: ConnectionStatus;
}) {
  return (
    <>
      <div className="cairn-card__header">
        <div>
          <h3 className="cairn-card__title">{client.name}</h3>
          <p className="cairn-card__description">{client.how}</p>
        </div>
        <AvailabilityBadge client={client} connectionStatus={connectionStatus} />
      </div>
      {client.copy ? (
        <div style={{ marginTop: '0.875rem' }}>
          <CopyableCode value={client.copy.value} label={client.copy.label} />
        </div>
      ) : client.supported ? (
        <div className="cairn-row" style={{ marginTop: '0.875rem' }}>
          <LinkButton tone="secondary" href="#client-name">
            Get a connection code
          </LinkButton>
        </div>
      ) : null}
      {client.note ? (
        <p className="cairn-note" style={{ margin: '0.625rem 0 0' }}>
          {client.note}
        </p>
      ) : null}
      {client.extras?.map((extra) => (
        <div key={extra.summary} style={{ marginTop: '0.75rem' }}>
          <Disclosure summary={extra.summary}>
            <p style={{ marginTop: 0 }}>{extra.body}</p>
            {extra.copy ? <CopyableCode value={extra.copy.value} label={extra.copy.label} /> : null}
          </Disclosure>
        </div>
      ))}
    </>
  );
}

/** Dates in the connections table, without the milliseconds nobody reads. */
function shortDate(when: Date): string {
  return when.toISOString().slice(0, 10);
}
function shortDateTime(when: Date): string {
  return when.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadConnections(context);
  const active = view.clients.filter((c) => !c.revokedAt);
  const connectionStatusByAgent = new Map<PrimaryAgentId, ConnectionStatus>();
  for (const connection of active) {
    const agentId = primaryAgentIdForConnection(connection.name);
    if (!agentId) continue;
    const status: ConnectionStatus = connection.lastUsedAt ? 'Working' : 'Connected';
    if (status === 'Working' || !connectionStatusByAgent.has(agentId)) {
      connectionStatusByAgent.set(agentId, status);
    }
  }
  // When sign-in is available, pasting an address is the whole story and the
  // connection-code machinery becomes the fallback for tools that cannot do it.
  const signInMode = view.authMode === 'oauth';
  const clients = mcpClients(signInMode, view.mcpUrl);
  const params = await searchParams;
  const requestedTool = PRIMARY_AGENT_META.some((agent) => agent.id === params.tool)
    ? params.tool
    : 'claude';
  const primaryClients = PRIMARY_AGENT_META.flatMap((agent) => {
    const client = clients.find((candidate) => candidate.id === agent.id);
    return client ? [{ ...agent, client }] : [];
  });
  const selectedAgent =
    primaryClients.find((agent) => agent.id === requestedTool) ?? primaryClients[0];
  const otherClients = clients.filter(
    (client) => !PRIMARY_AGENT_META.some((agent) => agent.id === client.id),
  );
  const helloPrompt = `Before we start, use ${PRODUCT.name}. Call whoami and setup_status once, then search_memory before asking me to repeat context. When a durable decision or preference emerges, use propose_memory_update so I can review it. Tell me what you found and cite the source.`;

  const steps = signInMode
    ? [
        {
          title: 'Copy from your tool’s card',
          body: 'Each card above carries the exact thing to paste and says where it goes. Nothing else is needed.',
        },
        {
          title: 'Say yes once',
          body: 'The tool brings you back to a Cairn page that asks whether this is alright. After that it can look things up — and you can turn it off below, any time, immediately.',
        },
      ]
    : [
        {
          title: 'Make a connection code',
          body: 'Use the form below. The code is shown once, so copy it right away.',
        },
        {
          title: 'Paste it where your tool’s card says',
          body: 'After that the tool can look things up — and you can turn it off below, any time, immediately.',
        },
      ];

  return (
    <AppShell current="/connections" email={context.email}>
      <h1 className="cairn-page-title">AI tools</h1>
      <p className="cairn-page-lede">
        You can let an AI tool you already use look things up in your memory, so you stop repeating
        yourself. It only ever sees what you have saved, and only what you allow.
      </p>

      <Callout tone="info" title="What a connected tool can and cannot do">
        <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.125rem' }}>
          <li>It can look up saved memory and see where each piece came from.</li>
          <li>It cannot see anything still waiting for your review, or anything you removed.</li>
          <li>It cannot change or delete your memory. At most it can suggest something new.</li>
          <li>You can turn any connection off at any time, immediately.</li>
          <li>
            Once a tool has your text, that company&rsquo;s own terms apply to it. This is true of
            every AI tool, and it is why nothing is shared until you decide.
          </li>
        </ul>
      </Callout>

      <section style={{ marginTop: '2rem' }} aria-labelledby="which-tool">
        <div className="cairn-section-head">
          <div>
            <p className="cairn-eyebrow">Step 1 of 3</p>
            <h2 id="which-tool" className="cairn-section-title">
              Choose the AI you use first
            </h2>
          </div>
          <span className="cairn-note">You can add the others later.</span>
        </div>

        {primaryClients.length > 0 ? (
          <>
            <nav className="cairn-agent-picker" aria-label="AI tools">
              {primaryClients.map((agent) => {
                const isSelected = selectedAgent?.id === agent.id;
                const connectionStatus = connectionStatusByAgent.get(agent.id);
                return (
                  <Link
                    key={agent.id}
                    href={`/connections?tool=${agent.id}`}
                    className="cairn-agent-choice"
                    aria-current={isSelected ? 'step' : undefined}
                  >
                    <span className="cairn-agent-choice__mark" aria-hidden="true">
                      {agent.mark}
                    </span>
                    <span>
                      <strong className="cairn-agent-choice__name">{agent.label}</strong>
                      <span className="cairn-agent-choice__detail">
                        {connectionStatus ? `${connectionStatus} · ` : ''}
                        {agent.detail}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            {selectedAgent ? (
              <div className="cairn-agent-setup">
                <div className="cairn-agent-setup__main">
                  <p className="cairn-eyebrow">Step 2 of 3 · Add {PRODUCT.name}</p>
                  <ClientInstructions
                    client={selectedAgent.client}
                    connectionStatus={connectionStatusByAgent.get(selectedAgent.id)}
                  />
                </div>
                <aside className="cairn-agent-setup__test" aria-labelledby="test-connection">
                  <p className="cairn-eyebrow">Step 3 of 3</p>
                  <h3 id="test-connection" className="cairn-card__title">
                    Say hello in {selectedAgent.label}
                  </h3>
                  <p className="cairn-card__description">
                    {signInMode
                      ? 'After you approve the sign-in, paste this once.'
                      : 'After you add the connection code, paste this once.'}{' '}
                    The answer proves the connection works and teaches the tool how to carry context
                    forward.
                  </p>
                  <div style={{ marginTop: '0.875rem' }}>
                    <CopyableCode value={helloPrompt} label="Copy test prompt" />
                  </div>
                </aside>
              </div>
            ) : null}

            <Callout tone="info" title="One memory, not four agents talking behind your back">
              Claude, Claude Code, Codex and ChatGPT do not message one another. Each asks Cairn for
              the same approved memory. New facts become review suggestions first, so another tool
              only sees them after you keep them.
            </Callout>

            {otherClients.length > 0 ? (
              <div style={{ marginTop: '1rem' }}>
                <Disclosure summary="Other compatible AI tools">
                  <div className="cairn-grid">
                    {otherClients.map((client) => (
                      <Card key={client.id}>
                        <ClientInstructions client={client} />
                      </Card>
                    ))}
                  </div>
                </Disclosure>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
              Every tool below uses the same connection code, made in the section further down. What
              differs is where you put it.
            </p>
            <div className="cairn-grid">
              {clients.map((client) => (
                <Card key={client.id}>
                  <ClientInstructions client={client} />
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      {!signInMode ? (
        <section style={{ marginTop: '2rem' }} aria-labelledby="how-connecting">
          <h2 id="how-connecting" className="cairn-section-title">
            How connecting works
          </h2>
          <ol className="cairn-steps">
            {steps.map((step) => (
              <li className="cairn-step" key={step.title}>
                <h3 className="cairn-step__title">{step.title}</h3>
                <p className="cairn-step__body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section style={{ marginTop: '2rem' }} aria-labelledby="existing">
        <h2 id="existing" className="cairn-section-title">
          Your connections ({active.length})
        </h2>
        {view.clients.length === 0 ? (
          <EmptyState title="Nothing connected yet">
            Your memory is not being shared with anything.
          </EmptyState>
        ) : (
          <div className="cairn-table-wrap cairn-table-wrap--responsive">
            <table className="cairn-table cairn-table--responsive">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Allowed to</th>
                  <th scope="col">Connected</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="cairn-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.clients.map((client) => (
                  <tr key={client.id}>
                    <td data-label="Name">{client.name}</td>
                    <td data-label="Allowed to">
                      {client.scopes.includes('memory:propose')
                        ? 'Look things up and suggest'
                        : 'Look things up'}
                      <div className="cairn-meta">
                        {client.maxSensitivity === 'normal'
                          ? 'Sensitive memory excluded'
                          : 'Sensitive memory included'}
                      </div>
                      {/* Only named when it is actually narrowed. Spelling out
                          all eight types for every unrestricted connection
                          would bury the one that is restricted. */}
                      <div className="cairn-meta">
                        {client.memoryTypes === null
                          ? 'Every kind of memory'
                          : `Only ${client.memoryTypes
                              .map((type) => CANONICAL_DOCS[type].title.toLowerCase())
                              .join(', ')}`}
                      </div>
                    </td>
                    <td data-label="Connected">{shortDate(client.createdAt)}</td>
                    <td data-label="Last used">
                      {client.lastUsedAt ? shortDateTime(client.lastUsedAt) : 'Not yet'}
                    </td>
                    <td data-label="Status">
                      {client.revokedAt ? (
                        <Badge tone="neutral">Turned off</Badge>
                      ) : client.lastUsedAt ? (
                        <Badge tone="good">Working</Badge>
                      ) : (
                        <Badge tone="neutral">Set up, not used yet</Badge>
                      )}
                    </td>
                    <td data-label="Actions">
                      {client.revokedAt ? null : (
                        <ActionForm
                          action={revokeConnectedAi}
                          csrf={csrf}
                          hidden={{ clientId: client.id }}
                        >
                          <SubmitButton tone="danger" busyLabel="Turning off…">
                            Turn off
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="cairn-advanced-setup" open={!signInMode}>
        <summary style={{ display: signInMode ? undefined : 'none' }}>
          Advanced setup and connection codes
        </summary>
        <div className="cairn-advanced-setup__body">
          {signInMode ? (
            <section aria-labelledby="address">
              <h2 id="address" className="cairn-section-title">
                Any other tool
              </h2>
              <Card>
                <p style={{ marginTop: 0 }}>
                  Any tool that accepts a custom connector address can use this one. It will bring
                  you back here to ask whether that is alright, and you say yes once.
                </p>
                <CopyableCode value={view.mcpUrl} label="Copy address" />
                <p className="cairn-meta" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  If a tool cannot use an address at all, make a connection code below instead.
                </p>
              </Card>
            </section>
          ) : null}

          <section style={{ marginTop: '2rem' }} aria-labelledby="new-connection">
            <h2 id="new-connection" className="cairn-section-title">
              {signInMode ? 'Or make a connection code' : 'Connect a new tool'}
            </h2>
            {signInMode ? (
              <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
                Only needed for a tool that cannot use the address above, or one running on a
                computer with no browser.
              </p>
            ) : null}
            <Card>
              <ActionForm
                action={createConnectedAi}
                csrf={csrf}
                className="cairn-stack cairn-stack--md"
              >
                <div className="cairn-field">
                  <label className="cairn-field__label" htmlFor="client-name">
                    What is it called?
                  </label>
                  <p className="cairn-field__hint" id="client-name-hint">
                    Only for you, so you can tell your connections apart.
                  </p>
                  <input
                    id="client-name"
                    className="cairn-input"
                    name="name"
                    aria-describedby="client-name-hint"
                    placeholder="Claude on my laptop"
                    maxLength={80}
                  />
                </div>
                <fieldset className="cairn-fieldset">
                  <legend>What it is allowed to do</legend>
                  <label className="cairn-choice">
                    <input type="checkbox" name="allowProposals" />
                    Let it suggest new things to remember (you still review every one)
                  </label>
                  <label className="cairn-choice">
                    <input type="checkbox" name="includeSensitive" />
                    Include memory you marked sensitive
                  </label>
                </fieldset>
                <MemoryTypeScope />
                <div>
                  <SubmitButton busyLabel="Creating…">Create a connection code</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          </section>

          <section style={{ marginTop: '2rem' }} aria-labelledby="how-to">
            <h2 id="how-to" className="cairn-section-title">
              Where a connection code goes
            </h2>
            <Card>
              <p style={{ marginTop: 0 }}>
                After you create a code above, paste it into the AI tool you want to use. The exact
                steps differ per tool; the two most common are below.
              </p>

              <Disclosure summary="Claude Code">
                <p>Run this in a terminal, replacing the code with yours:</p>
                <pre className="cairn-code">
                  {`claude mcp add ${PRODUCT.slug} \\
  --env CAIRN_CONNECTION_CODE=your-code-here \\
  -- npx -y tsx ${'<path-to-this-project>'}/packages/mcp/src/bin/stdio.ts`}
                </pre>
              </Disclosure>

              <Disclosure summary="Codex, or anything that reads a config file">
                <p>Add this to the tool&rsquo;s MCP configuration:</p>
                <pre className="cairn-code">
                  {JSON.stringify(
                    {
                      mcpServers: {
                        [PRODUCT.slug]: {
                          command: 'npx',
                          args: [
                            '-y',
                            'tsx',
                            '<path-to-this-project>/packages/mcp/src/bin/stdio.ts',
                          ],
                          env: { CAIRN_CONNECTION_CODE: 'your-code-here' },
                        },
                      },
                    },
                    null,
                    2,
                  )}
                </pre>
              </Disclosure>

              <Disclosure summary="Technical details">
                <dl className="cairn-dl">
                  <div className="cairn-dl__row">
                    <dt className="cairn-dl__term">Remote address</dt>
                    <dd className="cairn-dl__detail">
                      <code className="cairn-code">{view.mcpUrl}</code>
                    </dd>
                  </div>
                  <div className="cairn-dl__row">
                    <dt className="cairn-dl__term">Transport</dt>
                    <dd className="cairn-dl__detail">Streamable HTTP, stateless</dd>
                  </div>
                  <div className="cairn-dl__row">
                    <dt className="cairn-dl__term">Protocol revision</dt>
                    <dd className="cairn-dl__detail">{MCP_PROTOCOL_REVISION}</dd>
                  </div>
                  <div className="cairn-dl__row">
                    <dt className="cairn-dl__term">Authorization</dt>
                    <dd className="cairn-dl__detail">
                      {view.authMode === 'oauth'
                        ? 'OAuth 2.1 bearer token, checked for issuer, audience and scopes'
                        : 'Bearer connection code, valid on this machine only'}
                    </dd>
                  </div>
                  <div className="cairn-dl__row">
                    <dt className="cairn-dl__term">Scopes</dt>
                    <dd className="cairn-dl__detail">
                      <code className="cairn-code">memory:read</code>, optionally{' '}
                      <code className="cairn-code">memory:propose</code>. Writing is not offered in
                      this release.
                    </dd>
                  </div>
                </dl>
              </Disclosure>
            </Card>
          </section>
        </div>
      </details>
    </AppShell>
  );
}

/**
 * Which kinds of memory a connection may read.
 *
 * The axis people actually reason about when connecting a work tool to a memory
 * that also holds personal context. Sensitivity does not answer it — a coding
 * assistant has good reason to read how you like things done and no reason at
 * all to read who your family is, and neither of those is sensitive.
 *
 * Every box starts ticked, so the default is unchanged from before this existed
 * and narrowing is a deliberate act. All-ticked is stored as "everything"
 * rather than as a list of today's eight types, so a connection nobody narrowed
 * keeps up with types added later — see `readMemoryTypes` in the server action.
 *
 * The labels are the same ones `/home` groups saved memory under. Nothing new
 * to learn: whatever "Decisions" means on the page where you read them is what
 * it means here where you share them.
 */
function MemoryTypeScope() {
  return (
    <fieldset className="cairn-fieldset">
      <legend>What it is allowed to read</legend>
      <p className="cairn-field__hint">
        Untick anything this tool has no business seeing. You can create a second connection with a
        different selection for a different tool.
      </p>
      {/* Tells the server the choice was offered at all, so a form that never
          showed these boxes still means "everything" rather than "nothing". */}
      <input type="hidden" name="memoryTypesOffered" value="1" />
      {memoryTypes.map((type) => (
        <label className="cairn-choice" key={type}>
          <input type="checkbox" name="memoryTypes" value={type} defaultChecked />
          {CANONICAL_DOCS[type].title}
        </label>
      ))}
    </fieldset>
  );
}
