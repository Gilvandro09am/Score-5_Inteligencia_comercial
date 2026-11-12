// Envia dados/processados/clientes-score5.json para o Supabase Storage.
// Uso: npm run publicar   (lê SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env.local)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "score5";
const ARQUIVO = "clientes-score5.json";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origem = path.join(raiz, "dados", "processados", ARQUIVO);

const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  console.error(
    "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env.local"
  );
  process.exit(1);
}

const headers = { Authorization: `Bearer ${chave}`, apikey: chave };

async function garantirBucket() {
  const r = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, { headers });
  if (r.ok) return;

  const criar = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (!criar.ok) {
    throw new Error(`Não foi possível criar o bucket: ${await criar.text()}`);
  }
  console.log(`Bucket privado "${BUCKET}" criado.`);
}

async function executar() {
  const conteudo = await fs.readFile(origem);
  JSON.parse(conteudo.toString("utf8")); // garante que o JSON é válido

  await garantirBucket();

  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${ARQUIVO}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "x-upsert": "true",
      "cache-control": "no-cache",
    },
    body: conteudo,
  });

  if (!r.ok) throw new Error(`Falha no envio (${r.status}): ${await r.text()}`);

  const mb = (conteudo.length / 1024 / 1024).toFixed(1);
  console.log(`Dados publicados no Supabase (${mb} MB).`);
  console.log("O site passa a mostrar os dados novos em até 5 minutos.");
}

executar().catch((erro) => {
  console.error("\nERRO AO PUBLICAR:");
  console.error(erro.message);
  process.exitCode = 1;
});
