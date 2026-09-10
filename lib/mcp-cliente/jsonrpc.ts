/**
 * Parser compartilhado de resposta JSON-RPC de um servidor MCP externo.
 *
 * Extraído de `validar-conexao.ts` para ser reusado por `chamar-ferramenta.ts`
 * (o consumo em turno de conversa) sem duplicar a regra — as duas pontas
 * falam com o MESMO servidor de terceiro e precisam entender o MESMO formato
 * de resposta.
 *
 * Bug real, achado testando ao vivo (2026-09-10): um servidor MCP
 * streamable-http responde `Content-Type: text/event-stream`, e o corpo vem
 * numa linha `data: {...}`, não `{...}` solto. Ignorar o prefixo `data:`
 * fazia todo `tools/list`/`tools/call` estourar `SyntaxError` mesmo com
 * credencial e servidor corretos.
 */
export function parsearCorpoJsonRpc(texto: string): unknown {
  const linhaJson = texto
    .split("\n")
    .map((l) => l.trim())
    .map((l) => (l.startsWith("data:") ? l.slice("data:".length).trim() : l))
    .find((l) => l.startsWith("{"));
  return JSON.parse(linhaJson ?? texto);
}
