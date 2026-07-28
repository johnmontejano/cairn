import { Badge, Callout, Card, Disclosure, EmptyState } from '@cairn/ui';
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
export default async function ConnectionsPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadConnections(context);
  const active = view.clients.filter((c) => !c.revokedAt);

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

      <section style={{ marginTop: '2rem' }} aria-labelledby="new-connection">
        <h2 id="new-connection" className="cairn-section-title">
          Connect a new tool
        </h2>
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
