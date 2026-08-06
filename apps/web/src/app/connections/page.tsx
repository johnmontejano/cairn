import { Badge, Callout, Card, Disclosure, EmptyState, LinkButton } from '@cairn/ui';
import { MCP_PROTOCOL_REVISION, PRODUCT } from '@cairn/config';
import { CANONICAL_DOCS, memoryTypes } from '@cairn/domain';
import { AppShell } from '@/components/chrome';
import { ActionForm, CopyableCode, SubmitButton } from '@/components/forms';
import { createConnectedAi, revokeConnectedAi } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadConnections } from '@/server/views';

export const metadata = { title: 'Connected AIs' };
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
  name: string;
  /** One sentence saying literally where the copied thing goes. */
  how: string;
  supported: boolean;
  copy?: { value: string; label: string };
  /** One line of small print under the thing to copy. */
  note?: string;
  /**
   * Folded-away second routes.
   *
   * The important one is the prompt you hand the tool itself. For Claude Code
   * and Codex the setup *is* a command, and those two can run a command — so
   * the shortest honest instruction is not "open a terminal and type this", it
   * is "tell it to do this". Every such prompt stops at the sign-in and hands
   * that part back, because an agent must never be the thing holding your
   * password. Tools where setup is a menu toggle get no prompt: an agent
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
        name: 'Claude Desktop',
        how: 'Add Cairn to your MCP servers in Settings, then paste the connection code when it asks.',
        supported: true,
      },
      {
        name: 'Claude Code',
        how: 'Run the claude mcp add command in your terminal, then paste the connection code.',
        supported: true,
      },
      {
        name: 'Cursor',
        how: 'Add Cairn under MCP in Cursor settings, with the connection code as the token.',
        supported: true,
      },
      {
        name: 'VS Code',
        how: 'Add Cairn through the MCP extension, using the connection code to sign in.',
        supported: true,
      },
      {
        name: 'ChatGPT',
        how: 'Needs the sign-in method this copy of Cairn does not have turned on. Connection codes are the tested path here.',
        supported: false,
      },
    ];
  }
  // Claude Code and Codex first: they are the pair most people want talking to
  // each other, and they are the two that can do their own setup.
  return [
    {
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
          body: `Same thing through the menus: open MCP servers in settings, add a server called ${PRODUCT.slug}, choose Streamable HTTP, and paste this address. Save, restart, then choose Authenticate next to ${PRODUCT.slug}. The terminal, the editor extension and the desktop app share one set of settings, so doing it in any one of them covers all three.`,
          copy: { value: mcpUrl, label: 'Copy address' },
        },
      ],
    },
    {
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
      name: 'ChatGPT in your browser',
      how: 'Not dependable yet here — it needs a Business or Enterprise workspace with developer mode switched on first. Use the ChatGPT desktop app instead: set up Codex above and the desktop app picks it up.',
      supported: false,
      extras: [
        {
          summary: 'If you do have a Business or Enterprise workspace',
          body: 'An admin turns on developer mode for the workspace, then you open Apps in your settings, choose Create, paste this address, and pick sign-in when it asks how to connect. Two things to expect: it may only be able to look things up, and you may have to sign in again after a while.',
          copy: { value: mcpUrl, label: 'Copy address' },
        },
      ],
    },
    {
      name: 'Cursor',
      how: 'In Cursor settings, add Cairn under MCP with this address. It sends you here to approve.',
      supported: true,
      copy: { value: mcpUrl, label: 'Copy address' },
    },
  ];
}

/** Dates in the connections table, without the milliseconds nobody reads. */
function shortDate(when: Date): string {
  return when.toISOString().slice(0, 10);
}
function shortDateTime(when: Date): string {
  return when.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function ConnectionsPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadConnections(context);
  const active = view.clients.filter((c) => !c.revokedAt);
  // When sign-in is available, pasting an address is the whole story and the
  // connection-code machinery becomes the fallback for tools that cannot do it.
  const signInMode = view.authMode === 'oauth';
  const clients = mcpClients(signInMode, view.mcpUrl);

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
      <h1 className="cairn-page-title">Connected AIs</h1>
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
        <h2 id="which-tool" className="cairn-section-title">
          {signInMode ? 'Connect an AI tool' : 'How to connect each tool'}
        </h2>
        <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
          {signInMode
            ? 'Connect more than one and they all read the same memory, so what you tell one, the others already know. Each card below has the one thing to copy and says where it goes.'
            : 'Every tool below uses the same connection code, made in the section further down. What differs is where you put it.'}
        </p>
        <div className="cairn-grid">
          {clients.map((client) => (
            <Card key={client.name}>
              <div className="cairn-card__header">
                <div>
                  <h3 className="cairn-card__title">{client.name}</h3>
                  <p className="cairn-card__description">{client.how}</p>
                </div>
                {client.supported ? (
                  <Badge tone="good">Works today</Badge>
                ) : (
                  <Badge tone="warn">Not yet</Badge>
                )}
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
                <p className="cairn-meta" style={{ margin: '0.5rem 0 0' }}>
                  {client.note}
                </p>
              ) : null}
              {/* Folded away on purpose. The one command is the whole card for
                  most people; the person who wants the agent to do it, or who
                  is in the app rather than the terminal, opens one thing. */}
              {client.extras?.map((extra) => (
                <div key={extra.summary} style={{ marginTop: '0.75rem' }}>
                  <Disclosure summary={extra.summary}>
                    <p style={{ marginTop: 0 }}>{extra.body}</p>
                    {extra.copy ? (
                      <CopyableCode value={extra.copy.value} label={extra.copy.label} />
                    ) : null}
                  </Disclosure>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </section>

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

      <section style={{ marginTop: '2rem' }} aria-labelledby="existing">
        <h2 id="existing" className="cairn-section-title">
          Your connections ({active.length})
        </h2>
        {view.clients.length === 0 ? (
          <EmptyState title="Nothing connected yet">
            Your memory is not being shared with anything.
          </EmptyState>
        ) : (
          <div className="cairn-table-wrap">
            <table className="cairn-table">
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
                    <td>{client.name}</td>
                    <td>
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
                    <td>{shortDate(client.createdAt)}</td>
                    <td>{client.lastUsedAt ? shortDateTime(client.lastUsedAt) : 'Not yet'}</td>
                    <td>
                      {client.revokedAt ? (
                        <Badge tone="neutral">Turned off</Badge>
                      ) : (
                        <Badge tone="good">Active</Badge>
                      )}
                    </td>
                    <td>
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

      {signInMode ? (
        <section style={{ marginTop: '2rem' }} aria-labelledby="address">
          <h2 id="address" className="cairn-section-title">
            Any other tool
          </h2>
          <Card>
            <p style={{ marginTop: 0 }}>
              Any tool that accepts a custom connector address can use this one. It will bring you
              back here to ask whether that is alright, and you say yes once.
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
            Only needed for a tool that cannot use the address above, or one running on a computer
            with no browser.
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
                      args: ['-y', 'tsx', '<path-to-this-project>/packages/mcp/src/bin/stdio.ts'],
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
                  <code className="cairn-code">memory:propose</code>. Writing is not offered in this
                  release.
                </dd>
              </div>
            </dl>
          </Disclosure>
        </Card>
      </section>
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
