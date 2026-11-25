// Lê os exports de tarefas do BEES Force (fBeesForce*.xlsx) e gera
// dados/processados/tarefas-score5.json com as tarefas em aberto (OPEN):
//  - rota do dia (última data de visita da operação): todas as tarefas em aberto;
//  - demais PDVs: tarefas MENSAIS ainda em aberto da última visita (as diárias já expiraram).
// Procura os arquivos em dados/entrada e em ../painel-tasks-compra/entrada (vale o mais recente).
// Nome fantasia dos PDVs: Pedidos Cora (.csv com "Nome fantasia") e faturados Promax (.csv "Empresa;Filial;...").
// Uso: npm run processar   (roda depois do Score 5)

import { lerPlanilha } from "./xlsx.mjs";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carregarCadastro, FILIAL_UNB } from "./cadastro-clientes.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrada = path.join(raiz, "dados", "entrada");
const saida = path.join(raiz, "dados", "processados");
const ARQUIVO_SAIDA = "tarefas-score5.json";
const PASTAS = [entrada, path.resolve(raiz, "..", "painel-tasks-compra", "entrada")];

// Arquivos das pastas de entrada; com o mesmo nome em duas pastas, fica o mais recente
async function listarArquivos() {
  const porNome = new Map();
  for (const pasta of PASTAS) {
    let nomes;
    try {
      nomes = await fs.readdir(pasta);
    } catch {
      continue;
    }
    for (const nome of nomes) {
      if (nome.startsWith("~$")) continue;
      const caminho = path.join(pasta, nome);
      const info = await fs.stat(caminho);
      if (!info.isFile()) continue;
      const atual = porNome.get(nome);
      if (!atual || info.mtimeMs > atual.mtime) porNome.set(nome, { nome, caminho, mtime: info.mtimeMs });
    }
  }
  return [...porNome.values()];
}

// ==================================================
// NOMES DOS PDVs (CSVs de pedidos)
// ==================================================

async function lerCsvPorLinha(caminho, encoding, aoLer) {
  const leitor = readline.createInterface({ input: createReadStream(caminho, { encoding }), crlfDelay: Infinity });
  let cab = null;
  for await (const linha of leitor) {
    const c = linha.split(";");
    if (!cab) {
      cab = c.map((x) => x.replace(/^﻿/, "").trim());
      continue;
    }
    aoLer(c, cab);
  }
}

async function carregarNomes(arquivos) {
  const cora = new Map();
  const promax = new Map();
  for (const a of arquivos.filter((f) => /\.csv$/i.test(f.nome))) {
    const inicio = (await fs.readFile(a.caminho)).subarray(0, 4096).toString("latin1");
    if (/^Empresa;Filial;/.test(inicio)) {
      console.log("Nomes (Promax):", a.nome);
      await lerCsvPorLinha(a.caminho, "latin1", (c, cab) => {
        const unb = FILIAL_UNB[`${c[0]?.trim()}/${c[1]?.trim()}`];
        const cliente = c[cab.indexOf("Cliente")]?.trim();
        const nome = c[cab.indexOf("Nome")]?.trim();
        if (unb && cliente && nome) promax.set(`${unb}_${cliente}`, nome);
      });
    } else if (inicio.includes("Nome fantasia") && inicio.includes("unidade venda")) {
      console.log("Nomes (Pedidos Cora):", a.nome);
      await lerCsvPorLinha(a.caminho, "utf8", (c, cab) => {
        const unb = c[cab.indexOf("Cód. unidade venda")]?.trim();
        const cliente = c[cab.indexOf("Cód. cliente")]?.trim();
        const nome = (c[cab.indexOf("Nome fantasia")] || c[cab.indexOf("Nome cliente")])?.trim();
        if (unb && cliente && nome) cora.set(`${unb}_${cliente}`, nome);
      });
    }
  }
  return (chave) => cora.get(chave) ?? promax.get(chave) ?? "";
}

// ==================================================
// REGRAS
// ==================================================

const OBRIGATORIAS = [
  "Unb",
  "Operação",
  "Pdv",
  "GV",
  "Setor",
  "Data Visita",
  "Cluster Primário",
  "Categoria",
  "Effectiveness Result",
  "QTD Solicitada",
  "QTD Já Comprada",
  "Texto da Tarefa",
];

const numeroOuNulo = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// Data do Excel (número de série) → "AAAA-MM-DD"
function dataISO(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
}

const DIAS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
function diaDaSemana(iso) {
  if (!iso) return "";
  return `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]}/`;
}

const RE_CERVEJA =
  /CERVEJA|BRAHMA|SKOL|BUDWEISER|\bBUD\b|STELLA|CORONA|SPATEN|ORIGINAL|MICHELOB|BOHEMIA|SERRAMALTE|PATR[IÍ]CIA|ANTARCTICA (PILSEN|SUBZERO|ORIGINAL)|BECK|COLORADO|GOOSE/;
const RE_NAB = /GUARAN|H2OH|PEPSI|SUKITA|SODA|T[OÔ]NICA|GATORADE|RED ?BULL|[AÁ]GUA|FUSION|\bNAB\b|LIPTON|DOLLY/;
const RE_LN = /LONG ?NECK|\bLN\b|\+LN/;

// Cesta da tarefa: agrupa pelo que o vendedor vai oferecer
function cestaDaTarefa(categoria, texto) {
  const t = texto.toUpperCase();
  if (categoria === "MATCH") return "Match";
  if (categoria === "NAB") return "NAB";
  if (categoria === "MKTPLACE") return "Marketplace";
  if (categoria === "BEER" || RE_CERVEJA.test(t)) {
    return RE_LN.test(t) ? "Cerveja Long Neck" : "Cerveja";
  }
  if (RE_NAB.test(t)) return "NAB";
  if (/MATCH|BEATS/.test(t)) return "Match";
  return "Outras";
}

// ==================================================
// EXECUÇÃO
// ==================================================

async function executar() {
  const todos = await listarArquivos();
  const arquivos = todos.filter(
    (f) => /\.xlsx$/i.test(f.nome) && /bees|tarefa/i.test(f.nome) && !/long ?neck/i.test(f.nome)
  );
  if (!arquivos.length) {
    console.log("Tarefas BEES: nenhum fBeesForce*.xlsx nas pastas de entrada — aba de oportunidades não atualizada.");
    return;
  }

  const dic = { operacoes: [], clusters: [], cestas: [], textos: [] };
  const idx = (lista, v) => {
    let i = lista.indexOf(v);
    if (i < 0) i = lista.push(v) - 1;
    return i;
  };
  const indiceTexto = new Map();
  const idxTexto = (v) => {
    if (!indiceTexto.has(v)) indiceTexto.set(v, dic.textos.push(v) - 1);
    return indiceTexto.get(v);
  };

  const rotas = {};
  const ultimas = {}; // "unb_pdv" → data da última visita
  const linhas = [];
  const vistos = new Set();

  for (const { nome: arquivo, caminho } of arquivos) {
    console.log("Lendo tarefas:", path.relative(raiz, caminho));
    const registros = await lerPlanilha(caminho);
    const faltando = OBRIGATORIAS.filter((c) => !(c in (registros[0] ?? {})));
    if (faltando.length) throw new Error(`${arquivo}: faltam as colunas ${faltando.join(", ")}`);

    const validos = registros.filter((r) => r.Pdv && r.Setor && r["Operação"]);

    // Rota do dia = data de visita mais recente de cada operação no export;
    // e a última visita de cada PDV no mês
    const ultimaData = {};
    const ultimaDoPdv = new Map();
    for (const r of validos) {
      const d = dataISO(r["Data Visita"]);
      if (!d) continue;
      if (!ultimaData[r["Operação"]] || d > ultimaData[r["Operação"]]) ultimaData[r["Operação"]] = d;
      const k = `${r.Unb}_${r.Pdv}`;
      if (!ultimaDoPdv.has(k) || d > ultimaDoPdv.get(k)) ultimaDoPdv.set(k, d);
    }

    let n = 0;
    let nRota = 0;
    for (const r of validos) {
      const op = r["Operação"];
      if (r["Effectiveness Result"] !== "OPEN") continue;
      const data = dataISO(r["Data Visita"]);
      const k = `${r.Unb}_${r.Pdv}`;
      if (data !== ultimaDoPdv.get(k)) continue;
      const naRota = data === ultimaData[op];
      const mensal = /MONTHLY/.test(r["Mensal/ Diária"] ?? "");
      if (!naRota && !mensal) continue; // tarefa diária de visita passada: expirou
      ultimas[k] = data;

      const texto = r["Texto da Tarefa"];
      const chave = `${r.Unb}|${r.Pdv}|${texto}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      linhas.push([
        idx(dic.operacoes, op),
        r.Unb,
        r.Pdv,
        r.Setor,
        r.GV,
        idx(dic.clusters, r["Cluster Primário"] || "Sem cluster"),
        idx(dic.cestas, cestaDaTarefa(r.Categoria, texto)),
        idxTexto(texto),
        numeroOuNulo(r["QTD Solicitada"]),
        numeroOuNulo(r["QTD Já Comprada"]),
        numeroOuNulo(r["Pontuação"]),
        naRota ? 1 : 0,
        mensal ? 1 : 0,
      ]);
      n++;
      if (naRota) nRota++;
    }
    Object.assign(rotas, ultimaData);
    console.log(
      `  ${n} tarefas em aberto (${nRota} na rota do dia: ${Object.entries(ultimaData).map(([o, d]) => `${o}: ${d}`).join("; ")})`
    );
  }

  // Nome e cidade: cadastro dClientes primeiro; nome também dos CSVs de pedidos
  const cadastro = await carregarCadastro(raiz);
  const nomeDe = await carregarNomes(todos);
  const nomes = {};
  const cidades = {};
  const visitas = {}; // "unb_pdv" → dias de visita do RN (ex.: "SEG/QUI/")
  for (const l of linhas) {
    const chave = `${l[1]}_${l[2]}`;
    if (chave in cidades) continue;
    const c = cadastro.get(chave);
    const n = c?.nome || nomeDe(chave);
    if (n) nomes[chave] = n;
    cidades[chave] = c?.cidade || "Sem cidade";
    // Sem dia no cadastro, usa o dia da semana da última visita do BEES
    visitas[chave] = c?.visita || diaDaSemana(ultimas[chave]);
  }
  const pdvs = new Set(linhas.map((l) => `${l[1]}_${l[2]}`)).size;
  console.log(`Nome fantasia encontrado para ${Object.keys(nomes).length} de ${pdvs} PDVs`);

  const resultado = { geradoEm: new Date().toISOString(), rotas, ...dic, nomes, cidades, visitas, ultimas, linhas };
  await fs.mkdir(saida, { recursive: true });
  await fs.writeFile(path.join(saida, ARQUIVO_SAIDA), JSON.stringify(resultado));
  console.log(`Tarefas em aberto: ${linhas.length} → dados/processados/${ARQUIVO_SAIDA}`);
}

executar().catch((erro) => {
  console.error("\nERRO AO LER TAREFAS:");
  console.error(erro.message);
  process.exitCode = 1;
});
