import { Badge, Callout, Card, Disclosure, EmptyState, LinkButton } from '@cairn/ui';
import { MCP_PROTOCOL_REVISION, PRODUCT } from '@cairn/config';
import { AppShell } from '@/components/chrome';
import { ActionForm, SubmitButton } from '@/components/forms';
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
 * Where the connection code goes, per tool.
 *
 * One "connect" instruction cannot be right for all of these. Some read a JSON
 * config file, some take a shell command, some need a setting toggled first.
 * Someone told simply to "connect" and handed a config snippet has been misled,
 * even harmlessly — and the moment they are unsure whether they did it right is
 * the moment they stop.
 *
 * `supported` is not decoration. A tool listed without saying it does not work
 * yet costs someone a wasted attempt and the belief that they broke it; naming
 * it plainly costs nothing and is true.
 */
function mcpClients(
  signInMode: boolean,
): ReadonlyArray<{ name: string; how: string; supported: boolean }> {
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
      how: 'Settings → Connectors → Add custom connector, then paste the address below. Claude opens a Cairn page where you say yes.',
      supported: true,
    },
    {
      name: 'ChatGPT',
      how: 'Settings → Apps → Create, paste the address below, and choose sign-in when it asks how to connect.',
      supported: true,
    },
    {
      name: 'Cursor',
      how: 'Add Cairn under MCP in Cursor settings using the address below. It will send you here to approve it.',
      supported: true,
    },
    {
      name: 'Claude Code',
      how: 'Run claude mcp add --transport http cairn with the address below. Your browser opens for approval.',
      supported: true,
    },
  ];
}

export default async function ConnectionsPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadConnections(context);
  const active = view.clients.filter((c) => !c.revokedAt);
  // When sign-in is available, pasting an address is the whole story and the
  // connection-code machinery becomes the fallback for tools that cannot do it.
  const signInMode = view.authMode === 'oauth';
  const clients = mcpClients(signInMode);
  // Every client's own instructions point at one of two places on this same
  // page: the address block (signed-in tools) or the connection-code form
  // (everything else, and the fallback for a signed-in tool that cannot use
  // the address). Either way it is a plain anchor into content already on
  // the page, not a new flow.
  const connectHref = signInMode ? '#address' : '#client-name';
  const connectLabel = signInMode ? 'Use the address above' : 'Get a connection code';

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

      {signInMode ? (
        <section style={{ marginTop: '2rem' }} aria-labelledby="address">
          <h2 id="address" className="cairn-section-title">
            Start here
          </h2>
          <Card>
            <p style={{ marginTop: 0 }}>
              Copy this address into the AI tool you want to use. It will bring you back here to ask
              whether that is alright, and you say yes once.
            </p>
            <pre className="cairn-code">{view.mcpUrl}</pre>
            <p className="cairn-meta" style={{ marginBottom: 0 }}>
              You do not need a code, a file, or a terminal. Everything below is only for tools that
              cannot use an address.
            </p>
          </Card>
        </section>
      ) : null}

      <section style={{ marginTop: '2rem' }} aria-labelledby="which-tool">
        <h2 id="which-tool" className="cairn-section-title">
          How to connect each tool
        </h2>
        <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
          {signInMode
            ? 'Every tool below uses the same address. What differs is where you paste it.'
            : 'Every tool below uses the same connection code, made in the next section. What differs is where you put it.'}
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
              {client.supported ? (
                <div className="cairn-row" style={{ marginTop: '0.875rem' }}>
                  <LinkButton tone="secondary" href={connectHref}>
                    {connectLabel}
                  </LinkButton>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

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

      <section style={{ marginTop: '2rem' }} aria-labelledby="existing">
        <h2 id="existing" className="cairn-section-title">
          Your connections ({active.length})
        </h2>
        {view.clients.length === 0 ? (
          <EmptyState title="Nothing connected yet">
            Your memory is not being shared with anything.
          </EmptyState>
        ) : (
          <div className="cairn-stack cairn-stack--md">
            {view.clients.map((client) => (
              <Card key={client.id}>
                <div className="cairn-card__header">
                  <div>
                    <h3 className="cairn-card__title">{client.name}</h3>
                    <div className="cairn-meta" style={{ marginTop: '0.25rem' }}>
                      {client.revokedAt ? (
                        <Badge tone="neutral">Turned off</Badge>
                      ) : (
                        <Badge tone="good">Active</Badge>
                      )}
                      <span>
                        {client.scopes.includes('memory:propose')
                          ? 'Can look things up and suggest'
                          : 'Can look things up'}
                      </span>
                      <span>
                        {client.maxSensitivity === 'normal'
                          ? 'Sensitive memory excluded'
                          : 'Sensitive memory included'}
                      </span>
                      <span>
                        {client.lastUsedAt
                          ? `Last used ${client.lastUsedAt.toISOString().slice(0, 16).replace('T', ' ')}`
                          : 'Not used yet'}
                      </span>
                    </div>
                  </div>
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
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: '2rem' }} aria-labelledby="how-to">
        <h2 id="how-to" className="cairn-section-title">
          How to finish the connection
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
