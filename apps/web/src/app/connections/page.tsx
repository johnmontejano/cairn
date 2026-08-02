import { Badge, Callout, Card, Disclosure, EmptyState, LinkButton } from '@cairn/ui';
import { MCP_PROTOCOL_REVISION, PRODUCT } from '@cairn/config';
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
function mcpClients(
  signInMode: boolean,
  mcpUrl: string,
): ReadonlyArray<{
  name: string;
  how: string;
  supported: boolean;
  copy?: { value: string; label: string };
}> {
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
  return [
    {
      name: 'Claude',
      how: 'In Claude, open Settings → Connectors → Add custom connector and paste this address. Claude brings you back here, and you say yes once.',
      supported: true,
      copy: { value: mcpUrl, label: 'Copy address' },
    },
    {
      name: 'Claude Code',
      how: 'Run this in your terminal. Your browser opens so you can approve it here.',
      supported: true,
      copy: {
        value: `claude mcp add --transport http ${PRODUCT.slug} ${mcpUrl}`,
        label: 'Copy command',
      },
    },
    {
      name: 'ChatGPT',
      how: 'In ChatGPT, open Settings → Apps → Create, paste this address, and pick sign-in when it asks how to connect.',
      supported: true,
      copy: { value: mcpUrl, label: 'Copy address' },
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
            ? 'Pick the tool you use. Its card has the exact thing to copy and says where to paste it.'
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
