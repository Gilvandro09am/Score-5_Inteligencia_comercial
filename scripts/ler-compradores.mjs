// Lê o faturado do Promax (03.02.37.csv) e gera dados/processados/compradores-score5.json:
// quantos clientes já compraram no mês (venda ou bonificação), por operação e RN,
// comparando com a carteira ativa de cada RN no dClientes.
//
// Regras (as mesmas do painel-tasks-compra):
//  - Notas que contam: operação 1 (venda) e 2 (bonificação), status A e E (C cancelada e D devolvida ficam de fora).
//  - Mês: o mais recente pela data de emissão (entrega) do arquivo.
//  - RN do comprador: setor do pedido. Carteira do RN: clientes "Ativo" com aquele Setor VDE no dClientes.

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { FILIAL_UNB, OPERACAO_UNB } from "./cadastro-clientes.mjs";
import { lerPlanilha } from "./xlsx.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_SAIDA = "compradores-score5.json";

const PEDIDOS = [
  path.join(raiz, "dados", "entrada", "03.02.37.csv"),
  "Z:/VENDAS/APR/Power BI/Fato/03.02.37/03.02.37.csv",
];
const CLIENTES = [
  path.join(raiz, "dados", "entrada", "dClientes.csv"),
  "Z:/VENDAS/APR/Power BI/Dimensão/dClientes/dClientes.csv",
];
const SETORES = [
  path.join(raiz, "dados", "entrada", "dSetores.csv"),
  "Z:/VENDAS/APR/Power BI/Dimensão/dSetores/dSetores.csv",
];
const REVENDAS = [
  path.join(raiz, "dados", "entrada", "dRevendas.csv"),
  "Z:/VENDAS/APR/Power BI/Dimensão/dRevendas/dRevendas.csv",
];

// Metas de compradores por setor: dados/entrada/Metas Compradores<AAAAMM>.xlsx
// (colunas Cod Unb, Cod Setor, Meta Compradores). Sem o arquivo do mês, usa o mais recente.
async function carregarMetas(mes) {
  const pasta = path.join(raiz, "dados", "entrada");
  let nomes = [];
  try {
    nomes = (await fs.readdir(pasta)).filter((n) => /^Metas Compradores\d{6}\.xlsx$/i.test(n) && !n.startsWith("~$"));
  } catch {
    return { arquivo: null, metas: new Map() };
  }
  const doMes = nomes.find((n) => n.includes(mes.replace("-", "")));
  const arquivo = doMes ?? nomes.sort().at(-1);
  const metas = new Map(); // "unb_setor" → meta
  if (!arquivo) return { arquivo: null, metas };
  for (const r of await lerPlanilha(path.join(pasta, arquivo))) {
    const unb = String(r["Cod Unb"] ?? "").trim();
    const setor = semZeros(r["Cod Setor"]);
    const meta = Number(String(r["Meta Compradores"] ?? "").replace(",", "."));
    if (!unb || !setor || !Number.isFinite(meta)) continue;
    metas.set(`${unb}_${setor}`, (metas.get(`${unb}_${setor}`) ?? 0) + meta); // soma se o setor vier em mais de um segmento
  }
  return { arquivo, metas };
}

// BI oficial da Ambev (Geo NE): compradores.xlsx com um PDV por linha e a coluna "Comp." (Sim/Não)
const BI_COMPRADORES = [
  path.join(raiz, "dados", "entrada", "compradores.xlsx"),
  "Z:/VENDAS/APR/Power BI/Fato/Painel Digital/compradores.xlsx",
];
const MESES = { jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06", jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12" };

/**
 * Compara, PDV a PDV, os compradores do acomp (faturado 03.02.37) com o BI da Ambev.
 * Motivos da divergência:
 *  balcao      comprou no balcão / sem RN (o BI só conta a carteira dos RNs)
 *  setorForaBi comprou por um setor que o BI não tem (ex.: 12 Digital)
 *  novo        fora da base do BI: cliente cadastrado no mês
 *  semVisita   fora da base do BI: sem dia de visita no cadastro
 *  foraBase    fora da base do BI: outros
 *  setor       os dois contam, mas em setores diferentes (BI = carteira; acomp = setor que faturou)
 *  biSim       BI diz que comprou e o acomp não tem nota
 *  biNao       acomp tem nota e o BI diz que não comprou
 */
async function compararComBi({ mes, compradores, cadastro, clientes, idxOp, setorDoComprador }) {
  const arquivo = await maisRecente(BI_COMPRADORES);
  if (!arquivo) {
    console.log("  BI compradores: compradores.xlsx não encontrado — quadro de divergência não atualizado.");
    return null;
  }
  const linhas = await lerPlanilha(arquivo);
  // Última linha do export: "Filtros aplicados: ... mes_ano é Nov/26"
  const filtro = linhas.map((r) => r["Cód. Unb."]).find((v) => /mes_ano/i.test(v ?? "")) ?? "";
  const m = filtro.match(/mes_ano é (\w{3})\/(\d{2})/i);
  const mesBi = m ? `20${m[2]}-${MESES[m[1].toLowerCase()] ?? "??"}` : "";
  if (mesBi && mesBi !== mes) console.warn(`  ATENÇÃO: BI compradores é de ${mesBi}, o faturado é de ${mes}.`);

  const base = new Map(); // "unb_pdv" → { setor, sim }
  const setoresBi = new Set(); // "op|setor"
  const cobertas = new Set(); // operações que vieram no export (o BI pode ser exportado só de algumas)
  const rn = {}; // "op|setor" → compradores no BI
  for (const r of linhas) {
    const unb = String(r["Cód. Unb."] ?? "").trim();
    const op = idxOp(unb);
    if (op < 0) continue;
    const setor = semZeros(r["Cod Setor"]);
    const sim = String(r["Comp."]).trim().toLowerCase() === "sim";
    base.set(`${unb}_${semZeros(r["Cod PDV"])}`, { setor, sim, nome: r["Nome Fantasia"]?.trim() ?? "" });
    setoresBi.add(`${op}|${setor}`);
    cobertas.add(op);
    if (sim) rn[`${op}|${setor}`] = (rn[`${op}|${setor}`] ?? 0) + 1;
  }

  // [op, pdv, nome, cidade, motivo, setor no acomp, setor no BI]
  const divergencias = [];
  const nomeCidade = (chave, nomeAlt) => {
    const cad = cadastro.get(chave);
    return [cad?.nome || nomeAlt || "", cad?.cidade || "Sem cidade"];
  };
  for (const [chave, r] of compradores) {
    const op = idxOp(r.unb);
    if (op < 0 || !cobertas.has(op)) continue;
    const cad = cadastro.get(chave);
    const setor = setorDoComprador(r, cad);
    const b = base.get(chave);
    let motivo = null;
    if (!b) {
      if (setor === "0") motivo = "balcao";
      else if (!setoresBi.has(`${op}|${setor}`)) motivo = "setorForaBi";
      else if (cad?.cadastroMes === mes) motivo = "novo";
      else if (!cad?.visita) motivo = "semVisita";
      else motivo = "foraBase";
    } else if (!b.sim) motivo = "biNao";
    else if (b.setor !== setor) motivo = "setor";
    if (motivo) divergencias.push([op, r.pdv, ...nomeCidade(chave, r.nome), motivo, setor, b?.setor ?? ""]);
  }
  for (const [chave, b] of base) {
    if (!b.sim || compradores.has(chave)) continue;
    const [unb, pdv] = chave.split("_");
    divergencias.push([idxOp(unb), pdv, ...nomeCidade(chave, b.nome), "biSim", "", b.setor]);
  }

  const totalBi = Object.values(rn).reduce((a, b) => a + b, 0);
  const totalAcomp = clientes.filter((l) => l[6] > 0 && cobertas.has(l[0])).length;
  const porMotivo = {};
  for (const d of divergencias) porMotivo[d[4]] = (porMotivo[d[4]] ?? 0) + 1;
  console.log(
    `  BI compradores: ${path.basename(arquivo)} (${mesBi || "mês ?"}; ${cobertas.size} de 8 operações) — BI ${totalBi} × acomp ${totalAcomp}; divergências`,
    porMotivo
  );

  const info = await fs.stat(arquivo);
  return { atualizadoEm: info.mtime.toISOString(), mes: mesBi, operacoes: [...cobertas].sort(), rn, divergencias };
}

const OPERACOES_QUE_CONTAM = { 1: "venda", 2: "bonificacao" };
const STATUS_FATURADO = new Set(["A", "E"]);

// O mais recente entre os locais disponíveis (a unidade Z: pode estar desconectada)
async function maisRecente(locais) {
  let melhor = null;
  for (const local of locais) {
    try {
      const info = await fs.stat(local);
      if (!melhor || info.mtimeMs > melhor.mtime) melhor = { caminho: local, mtime: info.mtimeMs };
    } catch {
      // indisponível
    }
  }
  return melhor?.caminho ?? null;
}

async function lerCsv(caminho, aoLer) {
  const leitor = readline.createInterface({
    input: createReadStream(caminho, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });
  let cab = null;
  for await (const linha of leitor) {
    const c = linha.split(";");
    if (!cab) {
      cab = c.map((x) => x.replace(/^\uFEFF|^ï»¿/, "").trim());
      continue;
    }
    aoLer(c, cab);
  }
}

const semZeros = (v) => String(v ?? "").trim().replace(/^0+(?=\d)/, "");
const numeroBR = (v) => {
  const n = Number(String(v ?? "").trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
// "24/11/2026" → "2026-11-24"
const iso = (d) => {
  const [dia, mes, ano] = String(d ?? "").trim().split("/");
  return ano ? `${ano}-${mes}-${dia}` : "";
};
// Setores de RN (1xx a 8xx); 0 e 9xx são balcão, interno ou inativos
const setorDeRn = (s) => {
  const n = Number(s);
  return n > 0 && n < 900;
};

function titulo(s) {
  return s
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s)(\p{L})/gu, (m, esp, l) => esp + l.toLocaleUpperCase("pt-BR"))
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (p) => p.toLowerCase());
}

async function executar() {
  const arqPedidos = await maisRecente(PEDIDOS);
  if (!arqPedidos) {
    console.log("Compradores: 03.02.37.csv não encontrado — aba Compradores não atualizada.");
    return;
  }

  // ---------- RNs (dSetores + dRevendas)
  const unbDaRevenda = {};
  const arqRevendas = await maisRecente(REVENDAS);
  if (arqRevendas) {
    await lerCsv(arqRevendas, (c, cab) => {
      unbDaRevenda[c[cab.indexOf("idRevenda")]?.trim()] = c[cab.indexOf("UNB")]?.trim();
    });
  }
  const rns = new Map(); // "unb_setor" → { gv, nome }
  const arqSetores = await maisRecente(SETORES);
  if (arqSetores) {
    await lerCsv(arqSetores, (c, cab) => {
      const unb = unbDaRevenda[c[cab.indexOf("Revenda")]?.trim()];
      const setor = semZeros(c[cab.indexOf("Setor")]);
      if (!unb || !setor) return;
      rns.set(`${unb}_${setor}`, {
        gv: semZeros(c[cab.indexOf("GV")]),
        nome: c[cab.indexOf("Vendedor")]?.trim() ?? "",
      });
    });
  }
  console.log(`Compradores: ${rns.size} RNs no dSetores`);

  // ---------- Carteira (dClientes)
  const cadastro = new Map(); // "unb_pdv" → { nome, cidade, setor, gv, ativo }
  const arqClientes = await maisRecente(CLIENTES);
  if (arqClientes) {
    await lerCsv(arqClientes, (c, cab) => {
      const g = (n) => c[cab.indexOf(n)]?.trim() ?? "";
      const unb = FILIAL_UNB[`${c[0]?.trim()}/${c[1]?.trim()}`];
      const pdv = g("Cód PDV");
      if (!unb || !pdv) return;
      cadastro.set(`${unb}_${pdv}`, {
        nome: g("Nome Fantasia") || g("Razão Social"),
        cidade: titulo(g("Cidade")),
        setor: semZeros(g("Setor VDE")),
        gv: semZeros(g("GV VDE")),
        ativo: g("Status do PDV") === "Ativo",
        cadastroMes: iso(g("Data de Cadastro")).slice(0, 7), // "AAAA-MM"
        visita: g("Dia de Visita do VDE"),
      });
    });
  }

  // ---------- Faturado (03.02.37)
  console.log("Lendo faturado:", arqPedidos);
  const notas = []; // itens que contam
  let mes = "";
  await lerCsv(arqPedidos, (c, cab) => {
    const tipo = OPERACOES_QUE_CONTAM[Number(c[2])];
    if (!tipo || !STATUS_FATURADO.has(c[9]?.trim())) return;
    const unb = FILIAL_UNB[`${c[0]?.trim()}/${c[1]?.trim()}`];
    if (!unb) return;
    const emissao = iso(c[6]);
    if (emissao.slice(0, 7) > mes) mes = emissao.slice(0, 7);
    notas.push({
      unb,
      pdv: semZeros(c[12]),
      nome: c[13]?.trim() ?? "",
      setor: semZeros(c[cab.indexOf("Setor")]),
      tipo,
      emissao,
      nota: c[7]?.trim(),
      total: numeroBR(c[cab.indexOf("Total")]),
    });
  });

  // ---------- Compradores do mês
  const compradores = new Map(); // "unb_pdv" → resumo
  let ultimaEmissao = "";
  for (const n of notas) {
    if (n.emissao.slice(0, 7) !== mes) continue;
    if (n.emissao > ultimaEmissao) ultimaEmissao = n.emissao;
    const chave = `${n.unb}_${n.pdv}`;
    let r = compradores.get(chave);
    if (!r) {
      r = { unb: n.unb, pdv: n.pdv, nome: n.nome, setores: new Map(), venda: false, bonificacao: false, notas: new Set(), valor: 0, ultima: "" };
      compradores.set(chave, r);
    }
    r[n.tipo] = true;
    r.notas.add(n.nota);
    if (n.tipo === "venda") r.valor += n.total;
    if (n.emissao > r.ultima) r.ultima = n.emissao;
    r.setores.set(n.setor, (r.setores.get(n.setor) ?? 0) + 1);
  }

  // ---------- Saída compacta
  const operacoes = Object.values(OPERACAO_UNB);
  const idxOp = (unb) => operacoes.indexOf(OPERACAO_UNB[unb]);
  // Setor do RN que mais faturou para o cliente no mês (balcão/interno → setor da carteira)
  const setorDoComprador = (r, cad) => {
    const ordem = [...r.setores].filter(([s]) => setorDeRn(s)).sort((a, b) => b[1] - a[1]);
    return ordem[0]?.[0] ?? (cad?.setor && setorDeRn(cad.setor) ? cad.setor : "0");
  };

  // [op, pdv, nome, cidade, setor do comprador, setor da carteira (ou ""), situação, notas, valor venda, última compra "DD/MM", dias de visita (ex.: "SEG/QUI/")]
  // situação: 0 = não comprou, 1 = venda, 2 = só bonificação
  const clientes = [];
  for (const [chave, r] of compradores) {
    const cad = cadastro.get(chave);
    clientes.push([
      idxOp(r.unb),
      r.pdv,
      cad?.nome || r.nome,
      cad?.cidade || "Sem cidade",
      setorDoComprador(r, cad),
      cad?.ativo && setorDeRn(cad.setor) ? cad.setor : "",
      r.venda ? 1 : 2,
      r.notas.size,
      Math.round(r.valor * 100) / 100,
      r.ultima.slice(8, 10) + "/" + r.ultima.slice(5, 7),
      cad?.visita ?? "",
    ]);
  }
  for (const [chave, cad] of cadastro) {
    if (!cad.ativo || !setorDeRn(cad.setor) || compradores.has(chave)) continue;
    const [unb, pdv] = chave.split("_");
    if (idxOp(unb) < 0) continue;
    clientes.push([idxOp(unb), pdv, cad.nome, cad.cidade || "Sem cidade", cad.setor, cad.setor, 0, 0, 0, "", cad.visita ?? ""]);
  }

  // RN: "op|setor" → [gv, nome]
  const rnsSaida = {};
  for (const l of clientes) {
    for (const setor of [l[4], l[5]]) {
      if (!setor) continue;
      const unb = Object.keys(OPERACAO_UNB)[l[0]];
      const k = `${l[0]}|${setor}`;
      if (rnsSaida[k]) continue;
      const rn = rns.get(`${unb}_${setor}`);
      rnsSaida[k] = [rn?.gv || "", setor === "0" ? "Balcão / sem RN" : rn?.nome || ""];
    }
  }
  // GV que falta (setor fora do dSetores): usa o GV VDE da carteira
  for (const [chave, cad] of cadastro) {
    const [unb] = chave.split("_");
    const k = `${idxOp(unb)}|${cad.setor}`;
    if (rnsSaida[k] && !rnsSaida[k][0] && cad.gv) rnsSaida[k][0] = cad.gv;
  }

  // Metas: "op|setor" → meta de compradores
  const { arquivo: arqMetas, metas } = await carregarMetas(mes);
  const metasSaida = {};
  for (const [k, meta] of metas) {
    const [unb, setor] = k.split("_");
    const op = idxOp(unb);
    if (op < 0) continue;
    metasSaida[`${op}|${setor}`] = meta;
    if (!rnsSaida[`${op}|${setor}`]) {
      const rn = rns.get(k);
      rnsSaida[`${op}|${setor}`] = [rn?.gv || "", rn?.nome || ""];
    }
  }
  console.log(
    arqMetas
      ? `  Metas de compradores: ${arqMetas} (${metas.size} setores, total ${[...metas.values()].reduce((a, b) => a + b, 0)})`
      : "  Metas de compradores: nenhum Metas Compradores<AAAAMM>.xlsx em dados/entrada"
  );

  // ---------- Divergência com o BI oficial da Ambev (compradores.xlsx do Painel Digital)
  const bi = await compararComBi({ mes, compradores, cadastro, clientes, idxOp, setorDoComprador });
  if (bi) {
    for (const k of Object.keys(bi.rn)) {
      if (rnsSaida[k]) continue;
      const [op, setor] = k.split("|");
      const rn = rns.get(`${Object.keys(OPERACAO_UNB)[op]}_${setor}`);
      rnsSaida[k] = [rn?.gv || "", rn?.nome || ""];
    }
  }

  const resultado = {
    geradoEm: new Date().toISOString(),
    mes,
    ultimaEmissao,
    operacoes,
    rns: rnsSaida,
    metas: metasSaida,
    bi,
    clientes,
  };
  const destino = path.join(raiz, "dados", "processados", ARQUIVO_SAIDA);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, JSON.stringify(resultado));

  const comprou = clientes.filter((l) => l[6] > 0);
  const carteira = clientes.filter((l) => l[5]);
  console.log(
    `  Mês ${mes} (até ${ultimaEmissao}): ${comprou.length} clientes compraram ` +
      `(${comprou.filter((l) => l[6] === 2).length} só bonificação); ` +
      `carteira ativa ${carteira.length}, positivada ${carteira.filter((l) => l[6] > 0).length}`
  );
  console.log(destino);
}

executar().catch((erro) => {
  console.error("\nERRO NOS COMPRADORES:");
  console.error(erro);
  process.exitCode = 1;
});
