import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * A QUEM O CONVERSADOR PODE CHAMAR VIA MCP EXTERNO NO BANCO (migration 0237).
 *
 * Mesmo molde de `escopo-de-funil-schema.test.ts` (0125) — o que só o
 * Postgres pode responder:
 *
 *  1. a coluna EXISTE no baseline aplicado — prova que a mudança chegou ao
 *     apêndice, e não só ao diretório de migrations (o kit self-host aplica
 *     apenas o baseline);
 *  2. ela nasce VAZIA — falha fechada por default do banco, não por código;
 *  3. o trigger de imutabilidade a COBRE — sem isso, o alcance a um sistema
 *     externo (possível ESCRITA do outro lado) seria editável numa versão
 *     publicada sem virar versão nova, a mesma ausência de escopo com
 *     aparência de controle que a 0125 já descreveu.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "e5c07e00-0000-4000-8000-000000000002";
let agente = "";
let versaoPublicada = "";
let canal = "";

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-conexoes-mcp-agente', 'Conexões MCP LTDA', 'Conexões MCP') on conflict (id) do nothing`,
    [ORG],
  );
  const { rows: a } = await pool.query<{ id: string }>(
    `insert into ai_agents (organization_id, name, kind, system_prompt, model)
     values ($1, 'Agente das conexões', 'mcp_agent', 'oi', 'claude-sonnet-4-6') returning id`,
    [ORG],
  );
  agente = a[0]!.id;

  // `channel_session_id` é NOT NULL — a versão precisa de um canal.
  const { rows: cs } = await pool.query<{ id: string }>(
    `insert into channel_sessions (organization_id, waha_session_name, display_name, webhook_secret_encrypted)
     values ($1, 'conexoes-mcp-session', 'Canal das conexões', decode('00','hex')) returning id`,
    [ORG],
  );
  const { rows: v } = await pool.query<{ id: string }>(
    `insert into ai_agent_versions
       (organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status, published_at)
     values ($1, $2, 1, 'oi', 'anthropic', 'claude-sonnet-4-6', $3, 'published', now()) returning id`,
    [ORG, agente, cs[0]!.id],
  );
  versaoPublicada = v[0]!.id;
  canal = cs[0]!.id;
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("a coluna", () => {
  it("existe no baseline aplicado — é o que o self-hoster recebe", async () => {
    const { rows } = await pool.query<{ data_type: string; column_default: string | null }>(
      `select data_type, column_default from information_schema.columns
        where table_name = 'ai_agent_versions' and column_name = 'mcp_connection_ids'`,
    );
    expect(rows, "a 0237 não chegou ao apêndice do baseline").toHaveLength(1);
    expect(rows[0]!.data_type).toBe("ARRAY");
  });

  it("nasce VAZIA — falha fechada pelo DEFAULT do banco, não por código", async () => {
    // Duas origens de falha fechada, como o repo já faz: o default cobre o
    // agente novo; o `?? []` no runtime (agent-config.ts) cobre o clone sem a
    // migration.
    const { rows } = await pool.query<{ mcp_connection_ids: string[] }>(
      "select mcp_connection_ids from ai_agent_versions where id = $1",
      [versaoPublicada],
    );
    expect(rows[0]!.mcp_connection_ids).toEqual([]);
  });
});

describe("o trigger de imutabilidade", () => {
  it("COBRE a coluna — o alcance a sistema externo não muda em versão publicada sem virar versão nova", async () => {
    await expect(
      pool.query("update ai_agent_versions set mcp_connection_ids = $2 where id = $1", [
        versaoPublicada,
        ["aaaaaaaa-0000-4000-8000-000000000001"],
      ]),
    ).rejects.toThrow(/imutável|imutavel/i);
  });

  it("RASCUNHO continua editável — senão ninguém configura nada", async () => {
    // Controle do outro lado: um trigger que travasse o draft tornaria a tela
    // de configuração inútil, e o teste acima passaria igual.
    const { rows } = await pool.query<{ id: string }>(
      `insert into ai_agent_versions
         (organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
       values ($1, $2, 2, 'oi', 'anthropic', 'claude-sonnet-4-6', $3, 'draft') returning id`,
      [ORG, agente, canal],
    );
    await expect(
      pool.query("update ai_agent_versions set mcp_connection_ids = $2 where id = $1", [
        rows[0]!.id,
        ["aaaaaaaa-0000-4000-8000-000000000001"],
      ]),
    ).resolves.toBeDefined();
  });
});
